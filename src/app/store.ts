/**
 * Editor state.
 *
 * A tiny external store rather than a context tree: the timeline and the
 * viewport both read the playhead sixty times a second, and putting that in
 * React context re-renders every panel on every frame. Components subscribe to
 * exactly the slice they need.
 *
 * Undo is a snapshot stack of the project document. The document is plain JSON
 * a few megabytes at most, structuredClone is fast, and "undo restores exactly
 * what you saw" is worth far more to a teacher than a memory optimisation.
 */

import type { Project, SceneDoc, SceneNode, Shot } from '../engine/types';
import { createStarterProject } from './starter-project';

export type PanelId = 'library' | 'script' | 'export' | 'learn';

export interface EditorState {
  project: Project;
  /** Playhead position in seconds. */
  time: number;
  playing: boolean;
  selectedNodeId: string | null;
  selectedSceneId: string;
  selectedShotId: string | null;
  panel: PanelId;
  /** Bumped whenever the 3D scene must be rebuilt from scratch. */
  sceneRevision: number;
  /** Bumped when only animation data changed — no rebuild needed. */
  dataRevision: number;
  message: { text: string; tone: 'info' | 'warn' | 'good' } | null;
  quality: 'draft' | 'good' | 'best';
  showCaptions: boolean;
  showOverlays: boolean;
}

type Listener = () => void;

class Store {
  private state: EditorState;
  private listeners = new Set<Listener>();
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  /** Coalesces rapid edits (dragging a slider) into one undo entry. */
  private lastCommit = 0;

  constructor() {
    const project = createStarterProject();
    this.state = {
      project,
      time: 0,
      playing: false,
      selectedNodeId: project.scenes[0]?.nodes[0]?.id ?? null,
      selectedSceneId: project.scenes[0]?.id ?? '',
      selectedShotId: project.sequence[0]?.id ?? null,
      panel: 'library',
      sceneRevision: 0,
      dataRevision: 0,
      message: null,
      quality: 'good',
      showCaptions: false,
      showOverlays: true,
    };
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private emit() {
    for (const fn of this.listeners) fn();
  }

  set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /* ---------------- undo ---------------- */

  private snapshot(coalesceMs = 0) {
    const now = Date.now();
    if (coalesceMs > 0 && now - this.lastCommit < coalesceMs) return;
    this.lastCommit = now;
    this.undoStack.push(structuredClone(this.state.project));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.state.project));
    this.state = {
      ...this.state,
      project: prev,
      sceneRevision: this.state.sceneRevision + 1,
      dataRevision: this.state.dataRevision + 1,
    };
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.state.project));
    this.state = {
      ...this.state,
      project: next,
      sceneRevision: this.state.sceneRevision + 1,
      dataRevision: this.state.dataRevision + 1,
    };
    this.emit();
  }

  /* ---------------- editing ---------------- */

  /**
   * Mutate the project.
   *
   * `rebuild` says whether the change alters scene *structure* (a new prop, a
   * different environment) or only data the evaluator reads each frame (a
   * keyframe, a transform). Rebuilding a garden takes ~60ms; doing that on
   * every drag of a slider would make the editor feel broken.
   */
  edit(
    fn: (project: Project) => void,
    opts: { rebuild?: boolean; coalesce?: number; label?: string } = {},
  ) {
    this.snapshot(opts.coalesce ?? 0);
    const project = structuredClone(this.state.project);
    fn(project);
    project.meta.modifiedAt = new Date().toISOString();
    project.meta.duration = Math.max(
      0.1,
      ...project.sequence.map((s) => s.start + s.duration),
    );
    this.state = {
      ...this.state,
      project,
      sceneRevision: this.state.sceneRevision + (opts.rebuild ? 1 : 0),
      dataRevision: this.state.dataRevision + 1,
    };
    this.emit();
  }

  loadProject(project: Project, message?: string) {
    this.undoStack.push(structuredClone(this.state.project));
    this.state = {
      ...this.state,
      project,
      time: 0,
      playing: false,
      selectedSceneId: project.scenes[0]?.id ?? '',
      selectedNodeId: project.scenes[0]?.nodes[0]?.id ?? null,
      selectedShotId: project.sequence[0]?.id ?? null,
      sceneRevision: this.state.sceneRevision + 1,
      dataRevision: this.state.dataRevision + 1,
      message: message ? { text: message, tone: 'good' } : null,
    };
    this.emit();
  }

  notify(text: string, tone: 'info' | 'warn' | 'good' = 'info') {
    this.set({ message: { text, tone } });
    window.setTimeout(() => {
      if (this.state.message?.text === text) this.set({ message: null });
    }, 5200);
  }

  /* ---------------- convenience selectors ---------------- */

  get scene(): SceneDoc | undefined {
    return this.state.project.scenes.find((s) => s.id === this.state.selectedSceneId);
  }

  get node(): SceneNode | undefined {
    return this.scene?.nodes.find((n) => n.id === this.state.selectedNodeId);
  }

  get shot(): Shot | undefined {
    return this.state.project.sequence.find((s) => s.id === this.state.selectedShotId);
  }

  /** Jump the playhead to the first shot that shows a given scene. */
  goToScene(sceneId: string) {
    const shot = this.state.project.sequence.find((s) => s.sceneId === sceneId);
    this.set({
      selectedSceneId: sceneId,
      selectedNodeId: this.state.project.scenes.find((s) => s.id === sceneId)?.nodes[0]?.id ?? null,
      selectedShotId: shot?.id ?? null,
      time: shot ? shot.start + 0.05 : this.state.time,
      playing: false,
    });
  }
}

export const store = new Store();

/** Unique-enough ids without pulling in a dependency. */
export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}
