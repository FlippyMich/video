/**
 * Real-time collaboration.
 *
 * Two or more people editing the same film, over a small WebSocket relay
 * (`server/collab.mjs`).
 *
 * **What this is.** Entity-level last-writer-wins. Edits are broadcast as
 * patches to a single scene, node, shot or the project metadata, each carrying
 * a version. A peer applies a patch only if its version is newer than the one
 * it holds. Presence — who is here, what they have selected, where their
 * playhead is — is broadcast separately and never persisted.
 *
 * **What this is not.** It is not a CRDT and it does not merge concurrent edits
 * to the *same* entity: if two people drag the same character at the same
 * moment, the later message wins and the earlier one is lost. That is a real
 * limitation and the UI says so, because silently discarding somebody's work
 * without telling them is worse than the limitation itself.
 *
 * In practice people working on a film divide by scene, and entity-level
 * granularity is enough for that. Proper convergent merging would mean
 * rebuilding the document as a CRDT, which is a much larger change than this
 * feature justifies.
 */

import type { Project, SceneDoc, SceneNode, Shot } from '../types';

export type PeerColour = string;

export interface Peer {
  id: string;
  name: string;
  colour: PeerColour;
  /** What they have selected, so the UI can show it. */
  selectedNodeId?: string | null;
  selectedSceneId?: string;
  time?: number;
  lastSeen: number;
}

export type EntityKind = 'meta' | 'scene' | 'node' | 'shot' | 'audio' | 'subtitle' | 'interaction';

export interface Patch {
  kind: EntityKind;
  /** Entity id. Empty for `meta`. */
  id: string;
  /** The entity's new value, or null to delete it. */
  value: unknown | null;
  /** For nodes: which scene they belong to. */
  parentId?: string;
  version: number;
  author: string;
}

type Outgoing =
  | { type: 'hello'; name: string; colour: string }
  | { type: 'presence'; peer: Omit<Peer, 'lastSeen'> }
  | { type: 'patch'; patch: Patch }
  | { type: 'snapshot-request' }
  | { type: 'snapshot'; to: string; project: Project; versions: Record<string, number> };

type Incoming =
  | { type: 'welcome'; you: string; peers: Peer[] }
  | { type: 'joined'; peer: Peer }
  | { type: 'left'; id: string }
  | { type: 'presence'; peer: Peer }
  | { type: 'patch'; patch: Patch }
  | { type: 'snapshot-request'; from: string }
  | { type: 'snapshot'; to: string; project: Project; versions: Record<string, number> };

export interface SessionCallbacks {
  onPeers(peers: Peer[]): void;
  /** A patch arrived and should be applied. */
  onPatch(patch: Patch): void;
  /** A full document arrived — we just joined. */
  onSnapshot(project: Project, versions: Record<string, number>): void;
  /** Somebody needs the document; return the current one. */
  provideSnapshot(): { project: Project; versions: Record<string, number> };
  onStatus(status: CollabStatus, detail?: string): void;
}

export type CollabStatus = 'offline' | 'connecting' | 'connected' | 'error';

const COLOURS = ['#ffc23d', '#ff8fb1', '#62c46b', '#63b8f0', '#b07cf0', '#ff9540', '#88e6c0'];

export class CollabSession {
  private socket: WebSocket | null = null;
  private peers = new Map<string, Peer>();
  private versions = new Map<string, number>();
  private selfId = '';
  private reconnectTimer = 0;
  private attempts = 0;
  private closedByUser = false;

  readonly name: string;
  readonly colour: string;

  constructor(
    private url: string,
    private room: string,
    private callbacks: SessionCallbacks,
    name?: string,
  ) {
    this.name = name || `Guest ${Math.floor(Math.random() * 900 + 100)}`;
    this.colour = COLOURS[Math.floor(Math.random() * COLOURS.length)];
  }

  get id() { return this.selfId; }
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  connect() {
    this.closedByUser = false;
    this.callbacks.onStatus('connecting');
    try {
      const socket = new WebSocket(`${this.url}?room=${encodeURIComponent(this.room)}`);
      this.socket = socket;

      socket.onopen = () => {
        this.attempts = 0;
        this.send({ type: 'hello', name: this.name, colour: this.colour });
      };

      socket.onmessage = (event) => {
        let message: Incoming;
        try { message = JSON.parse(event.data as string); } catch { return; }
        this.handle(message);
      };

      socket.onerror = () => {
        this.callbacks.onStatus('error', 'Could not reach the collaboration server.');
      };

      socket.onclose = () => {
        this.socket = null;
        this.peers.clear();
        this.callbacks.onPeers([]);
        if (this.closedByUser) {
          this.callbacks.onStatus('offline');
          return;
        }
        // Back off, but cap it: a laptop lid closed for an hour should still
        // reconnect promptly when it opens.
        this.attempts++;
        const delay = Math.min(15000, 600 * 2 ** Math.min(this.attempts, 5));
        this.callbacks.onStatus('connecting', `Reconnecting in ${(delay / 1000).toFixed(0)}s…`);
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      };
    } catch (err) {
      this.callbacks.onStatus('error', (err as Error).message);
    }
  }

  disconnect() {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private send(message: Outgoing) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private handle(message: Incoming) {
    switch (message.type) {
      case 'welcome': {
        this.selfId = message.you;
        this.peers.clear();
        for (const p of message.peers) this.peers.set(p.id, p);
        this.callbacks.onPeers([...this.peers.values()]);
        this.callbacks.onStatus('connected');
        // If anybody else is here, they have the document. If not, ours is it.
        if (message.peers.length) this.send({ type: 'snapshot-request' });
        break;
      }
      case 'joined':
        this.peers.set(message.peer.id, message.peer);
        this.callbacks.onPeers([...this.peers.values()]);
        break;
      case 'left':
        this.peers.delete(message.id);
        this.callbacks.onPeers([...this.peers.values()]);
        break;
      case 'presence':
        this.peers.set(message.peer.id, message.peer);
        this.callbacks.onPeers([...this.peers.values()]);
        break;
      case 'patch': {
        const key = `${message.patch.kind}:${message.patch.id}`;
        const known = this.versions.get(key) ?? 0;
        // Stale patches are dropped rather than applied out of order — that is
        // the whole of the conflict resolution, and it is why simultaneous
        // edits to one entity lose one of them.
        if (message.patch.version <= known) return;
        this.versions.set(key, message.patch.version);
        this.callbacks.onPatch(message.patch);
        break;
      }
      case 'snapshot-request': {
        const { project, versions } = this.callbacks.provideSnapshot();
        this.send({ type: 'snapshot', to: message.from, project, versions });
        break;
      }
      case 'snapshot': {
        if (message.to !== this.selfId) return;
        this.versions = new Map(Object.entries(message.versions));
        this.callbacks.onSnapshot(message.project, message.versions);
        break;
      }
    }
  }

  /* ---------------- outgoing ---------------- */

  private bump(kind: EntityKind, id: string): number {
    const key = `${kind}:${id}`;
    const next = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, next);
    return next;
  }

  broadcastScene(scene: SceneDoc) {
    this.send({
      type: 'patch',
      patch: { kind: 'scene', id: scene.id, value: scene, version: this.bump('scene', scene.id), author: this.selfId },
    });
  }

  broadcastNode(sceneId: string, node: SceneNode | null, nodeId?: string) {
    const id = node?.id ?? nodeId ?? '';
    this.send({
      type: 'patch',
      patch: { kind: 'node', id, parentId: sceneId, value: node, version: this.bump('node', id), author: this.selfId },
    });
  }

  broadcastShot(shot: Shot | null, shotId?: string) {
    const id = shot?.id ?? shotId ?? '';
    this.send({
      type: 'patch',
      patch: { kind: 'shot', id, value: shot, version: this.bump('shot', id), author: this.selfId },
    });
  }

  broadcastMeta(meta: Project['meta']) {
    this.send({
      type: 'patch',
      patch: { kind: 'meta', id: '', value: meta, version: this.bump('meta', ''), author: this.selfId },
    });
  }

  /** Presence is sent often and is deliberately not versioned or persisted. */
  broadcastPresence(state: { selectedNodeId?: string | null; selectedSceneId?: string; time?: number }) {
    this.send({
      type: 'presence',
      peer: { id: this.selfId, name: this.name, colour: this.colour, ...state },
    });
  }

  /** Snapshot version map, for handing to a joining peer. */
  versionMap(): Record<string, number> {
    return Object.fromEntries(this.versions);
  }
}

/**
 * Apply a received patch to a project, in place.
 * Returns whether the scene graph needs rebuilding.
 */
export function applyPatch(project: Project, patch: Patch): { changed: boolean; rebuild: boolean } {
  switch (patch.kind) {
    case 'meta':
      if (!patch.value) return { changed: false, rebuild: false };
      Object.assign(project.meta, patch.value as Project['meta']);
      return { changed: true, rebuild: false };

    case 'scene': {
      const value = patch.value as SceneDoc | null;
      const index = project.scenes.findIndex((s) => s.id === patch.id);
      if (!value) {
        if (index >= 0) project.scenes.splice(index, 1);
        return { changed: index >= 0, rebuild: true };
      }
      if (index >= 0) project.scenes[index] = value;
      else project.scenes.push(value);
      return { changed: true, rebuild: true };
    }

    case 'node': {
      const value = patch.value as SceneNode | null;
      const scene = project.scenes.find((s) => s.id === patch.parentId);
      if (!scene) return { changed: false, rebuild: false };
      const index = scene.nodes.findIndex((n) => n.id === patch.id);
      if (!value) {
        if (index >= 0) scene.nodes.splice(index, 1);
        return { changed: index >= 0, rebuild: true };
      }
      const isNew = index < 0;
      if (isNew) scene.nodes.push(value);
      else scene.nodes[index] = value;
      // Only structural changes need a rebuild; a moved node or a new keyframe
      // does not, and rebuilding a garden on every remote drag would make
      // collaboration unusable.
      const structural = isNew || scene.nodes[Math.max(0, index)]?.assetId !== value.assetId;
      return { changed: true, rebuild: structural };
    }

    case 'shot': {
      const value = patch.value as Shot | null;
      const index = project.sequence.findIndex((s) => s.id === patch.id);
      if (!value) {
        if (index >= 0) project.sequence.splice(index, 1);
      } else if (index >= 0) {
        project.sequence[index] = value;
      } else {
        project.sequence.push(value);
        project.sequence.sort((a, b) => a.start - b.start);
      }
      return { changed: true, rebuild: false };
    }

    default:
      return { changed: false, rebuild: false };
  }
}
