/**
 * Wiring the collaboration session to the editor store.
 *
 * The bridge watches the store, works out what changed, and broadcasts it; and
 * it applies patches arriving from other people.
 *
 * **How it decides what to send.** Rather than instrument every edit call site,
 * it compares the serialised form of the entities an edit could plausibly have
 * touched — the selected scene, the selected shot, and the project metadata —
 * against what it last sent, on a debounce. That covers every editing path in
 * the app without a parallel bookkeeping system that could drift out of sync
 * with the real one.
 *
 * The cost is that an edit to a scene you are *not* currently looking at would
 * not be broadcast. Nothing in the interface can do that today, and the check
 * is cheap and obviously correct, which is worth more here than generality.
 */

import type { Project } from '../engine/types';
import { CollabSession, applyPatch, type Peer, type CollabStatus } from '../engine/collab/session';
import { store } from './store';

const DEBOUNCE_MS = 220;

export interface CollabState {
  status: CollabStatus;
  detail?: string;
  peers: Peer[];
  room: string;
  url: string;
}

type Listener = (state: CollabState) => void;

class CollabBridge {
  private session: CollabSession | null = null;
  private listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
  private timer = 0;
  private lastSent = new Map<string, string>();
  /** Set while applying a remote patch, so we don't echo it straight back. */
  private applying = false;

  private state: CollabState = { status: 'offline', peers: [], room: '', url: '' };

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<CollabState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  get peers() { return this.state.peers; }
  get isConnected() { return this.state.status === 'connected'; }

  connect(url: string, room: string, name?: string) {
    this.disconnect();
    this.set({ url, room, status: 'connecting', peers: [] });

    this.session = new CollabSession(url, room, {
      onPeers: (peers) => this.set({ peers }),
      onStatus: (status, detail) => this.set({ status, detail }),
      onPatch: (patch) => {
        this.applying = true;
        try {
          let rebuild = false;
          store.edit((project) => {
            const result = applyPatch(project, patch);
            rebuild = result.rebuild;
          }, { rebuild: false });
          if (rebuild) store.set({ sceneRevision: store.getState().sceneRevision + 1 });
        } finally {
          this.applying = false;
          this.remember(store.getState().project);
        }
      },
      onSnapshot: (project) => {
        this.applying = true;
        try {
          store.loadProject(project, 'Loaded the film from the person you joined.');
        } finally {
          this.applying = false;
          this.remember(project);
        }
      },
      provideSnapshot: () => ({
        project: store.getState().project,
        versions: this.session?.versionMap() ?? {},
      }),
    }, name);

    this.session.connect();
    this.remember(store.getState().project);

    this.unsubscribe = store.subscribe(() => {
      if (this.applying) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.flush(), DEBOUNCE_MS);
    });
  }

  disconnect() {
    window.clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.disconnect();
    this.session = null;
    this.lastSent.clear();
    this.set({ status: 'offline', peers: [], detail: undefined });
  }

  /** Record the current serialised form of everything we might broadcast. */
  private remember(project: Project) {
    this.lastSent.clear();
    this.lastSent.set('meta', JSON.stringify(project.meta));
    for (const scene of project.scenes) this.lastSent.set(`scene:${scene.id}`, JSON.stringify(scene));
    for (const shot of project.sequence) this.lastSent.set(`shot:${shot.id}`, JSON.stringify(shot));
  }

  private flush() {
    const session = this.session;
    if (!session?.connected) return;
    const state = store.getState();
    const project = state.project;

    const scene = project.scenes.find((s) => s.id === state.selectedSceneId);
    if (scene) {
      const key = `scene:${scene.id}`;
      const json = JSON.stringify(scene);
      if (this.lastSent.get(key) !== json) {
        this.lastSent.set(key, json);
        session.broadcastScene(scene);
      }
    }

    const shot = project.sequence.find((s) => s.id === state.selectedShotId);
    if (shot) {
      const key = `shot:${shot.id}`;
      const json = JSON.stringify(shot);
      if (this.lastSent.get(key) !== json) {
        this.lastSent.set(key, json);
        session.broadcastShot(shot);
      }
    }

    const metaJson = JSON.stringify(project.meta);
    if (this.lastSent.get('meta') !== metaJson) {
      this.lastSent.set('meta', metaJson);
      session.broadcastMeta(project.meta);
    }

    session.broadcastPresence({
      selectedNodeId: state.selectedNodeId,
      selectedSceneId: state.selectedSceneId,
      time: state.time,
    });
  }
}

export const collab = new CollabBridge();
