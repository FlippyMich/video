/**
 * The editor shell.
 *
 * Three columns and a timeline: what you're making in the middle, what you can
 * add on the left, what the selected thing does on the right. That layout is
 * unremarkable on purpose — the novel part of this app is what it removes, not
 * where it puts its panels.
 */

import { useEffect } from 'react';
import { Viewport } from './panels/Viewport';
import { Timeline } from './panels/Timeline';
import { AssetLibrary } from './panels/AssetLibrary';
import { Inspector } from './panels/Inspector';
import { ScriptPanel } from './panels/ScriptPanel';
import { ExportPanel } from './panels/ExportPanel';
import { LearnPanel } from './panels/LearnPanel';
import { SceneList } from './panels/SceneList';
import { CollabBar } from './panels/CollabBar';
import { store, type PanelId } from './store';
import { useEditor } from './useEditor';
import { bakeAction, mergeTracks, type ActionId } from '../engine/anim/clips';
import { CHARACTER_BY_ID } from '../engine/assets/characters';
import type { Project } from '../engine/types';

const PANELS: { id: PanelId; label: string; key: string }[] = [
  { id: 'library', label: 'Library', key: '1' },
  { id: 'script', label: 'Script', key: '2' },
  { id: 'export', label: 'Export', key: '3' },
  { id: 'learn', label: 'Learn', key: '4' },
];

export function App() {
  const { panel, title, message, duration } = useEditor((s) => ({
    panel: s.panel,
    title: s.project.meta.title,
    message: s.message,
    duration: s.project.meta.duration,
  }));

  useKeyboard();
  useActionDrop();
  useProjectFileDrop();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>✿</span>
          <div>
            <strong>BloomStudio</strong>
            <em>3D animation for children’s videos</em>
          </div>
        </div>

        <input
          className="title-field"
          value={title}
          onChange={(e) => store.edit((p) => { p.meta.title = e.target.value; }, { coalesce: 600 })}
          aria-label="Film title"
        />
        <span className="runtime">{formatClock(duration)}</span>

        <nav className="panel-tabs">
          {PANELS.map((p) => (
            <button
              key={p.id}
              className={panel === p.id ? 'panel-tab on' : 'panel-tab'}
              onClick={() => store.set({ panel: p.id })}
              title={`${p.label} (${p.key})`}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <CollabBar />
          <button className="btn ghost small" onClick={() => store.undo()} title="Undo (Ctrl/⌘ Z)">Undo</button>
          <button className="btn ghost small" onClick={() => store.redo()} title="Redo (Ctrl/⌘ ⇧ Z)">Redo</button>
        </div>
      </header>

      <main className="layout">
        <aside className="col left">
          {panel === 'library' && <AssetLibrary />}
          {panel === 'script' && <ScriptPanel />}
          {panel === 'export' && <ExportPanel />}
          {panel === 'learn' && <LearnPanel />}
        </aside>

        <section className="col centre">
          <Viewport />
          <Timeline />
        </section>

        <aside className="col right">
          <SceneList />
          <Inspector />
        </aside>
      </main>

      {message && (
        <div className={`toast ${message.tone}`} role="status">
          {message.text}
        </div>
      )}
    </div>
  );
}

function formatClock(t: number) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Global keyboard
 * ------------------------------------------------------------------ */

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Never steal keys from a field the user is typing in.
      if (target.matches('input, textarea, select, [contenteditable]')) return;

      const s = store.getState();
      const fps = s.project.meta.fps;
      const step = e.shiftKey ? 1 : 1 / fps;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          store.set({ playing: !s.playing, time: s.time >= s.project.meta.duration - 0.01 ? 0 : s.time });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          store.set({ time: Math.max(0, s.time - step), playing: false });
          break;
        case 'ArrowRight':
          e.preventDefault();
          store.set({ time: Math.min(s.project.meta.duration, s.time + step), playing: false });
          break;
        case 'Home':
          store.set({ time: 0, playing: false });
          break;
        case 'End':
          store.set({ time: s.project.meta.duration, playing: false });
          break;
        case 'Delete':
        case 'Backspace': {
          if (!s.selectedNodeId) return;
          e.preventDefault();
          store.edit((p) => {
            for (const scene of p.scenes) {
              const i = scene.nodes.findIndex((n) => n.id === s.selectedNodeId);
              if (i >= 0) { scene.nodes.splice(i, 1); return; }
            }
          }, { rebuild: true });
          store.set({ selectedNodeId: null });
          break;
        }
        default: {
          const hit = PANELS.find((p) => p.key === e.key);
          if (hit) store.set({ panel: hit.id });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/* ------------------------------------------------------------------ *
 * Adding an action from the library
 * ------------------------------------------------------------------ */

function useActionDrop() {
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, action, start, duration } = (e as CustomEvent).detail as {
        nodeId: string; action: ActionId; start: number; duration: number;
      };
      store.edit((project) => {
        for (const scene of project.scenes) {
          const node = scene.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          const family = CHARACTER_BY_ID.get(node.assetId)?.rigFamily ?? 'biped';
          const baked = bakeAction(action, {
            start, duration, family,
            intensity: 1,
            mirror: node.position[0] > 0,
          });
          // Merge rather than replace: layering is the whole point of the clip
          // system, and replacing would wipe an existing walk when you add a wave.
          node.tracks = mergeTracks(node.tracks ?? [], baked);
          return;
        }
      });
      store.notify(`Added “${action}” at ${start.toFixed(2)}s`, 'good');
    };
    window.addEventListener('bloom:add-action', handler);
    return () => window.removeEventListener('bloom:add-action', handler);
  }, []);
}

/* ------------------------------------------------------------------ *
 * Opening a project file by dropping it on the window
 * ------------------------------------------------------------------ */

function useProjectFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file || !/\.(json)$/i.test(file.name)) return;
      e.preventDefault();
      try {
        const project = JSON.parse(await file.text()) as Project;
        if (!project.meta || !project.scenes) throw new Error('That does not look like a BloomStudio project.');
        store.loadProject(project, `Opened “${project.meta.title}”.`);
      } catch (err) {
        store.notify(`Could not open that file: ${(err as Error).message}`, 'warn');
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}
