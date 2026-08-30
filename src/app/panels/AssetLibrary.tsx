/**
 * The asset library.
 *
 * Drag anything onto the stage to place it. Everything in here is generated
 * from code, so the library opens instantly and works offline — there is no
 * download step and nothing to wait for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS } from '../../engine/assets/characters';
import { PROPS } from '../../engine/assets/props';
import { ENVIRONMENTS } from '../../engine/assets/environments';
import { FX_LIST, SIM_LIST } from '../../engine/fx/particles';
import { ACTIONS } from '../../engine/anim/clips';
import { store, uid } from '../store';
import { useEditor } from '../useEditor';
import type { SceneNode } from '../../engine/types';

type Tab = 'characters' | 'props' | 'sets' | 'effects' | 'actions';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'characters', label: 'Characters', hint: 'Drag onto the stage to add someone.' },
  { id: 'props', label: 'Props', hint: 'Flowers, food, furniture and things to hold.' },
  { id: 'sets', label: 'Sets', hint: 'Click to change where this scene happens.' },
  { id: 'effects', label: 'Effects', hint: 'Sparkles, petals, confetti and more.' },
  { id: 'actions', label: 'Actions', hint: 'Click to make the selected character do something.' },
];

export function AssetLibrary() {
  const [tab, setTab] = useState<Tab>('characters');
  const [query, setQuery] = useState('');
  const { sceneId, scene, selectedNodeId, time } = useEditor((s) => ({
    sceneId: s.selectedSceneId,
    scene: s.project.scenes.find((x) => x.id === s.selectedSceneId),
    selectedNodeId: s.selectedNodeId,
    time: s.time,
  }));

  const q = query.trim().toLowerCase();
  const match = (name: string, desc: string) =>
    !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);

  const items = useMemo(() => {
    if (tab === 'characters') {
      return CHARACTERS.filter((c) => match(c.name, c.description))
        .map((c) => ({ id: c.id, name: c.name, description: c.description, kind: 'character' as const, group: c.group }));
    }
    if (tab === 'props') {
      return PROPS.filter((p) => match(p.name, p.description))
        .map((p) => ({ id: p.id, name: p.name, description: p.description, kind: 'prop' as const, group: p.group }));
    }
    if (tab === 'effects') {
      return [...FX_LIST, ...SIM_LIST].filter((f) => match(f.name, f.description))
        .map((f) => ({ id: f.id as string, name: f.name, description: f.description, kind: 'fx' as const, group: 'effects' }));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q]);

  const addNode = (asset: { id: string; kind: string; name: string }, position: [number, number, number]) => {
    store.edit((project) => {
      const target = project.scenes.find((s) => s.id === sceneId);
      if (!target) return;
      const node: SceneNode = {
        id: uid(asset.kind),
        name: asset.name,
        kind: asset.kind as SceneNode['kind'],
        assetId: asset.id,
        position,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        params: asset.kind === 'character' ? { seed: Math.floor(Math.random() * 90) + 1 } : {},
        tracks: [],
      };
      // Bees and birds belong in the air.
      if (asset.id.includes('bee') || asset.id.includes('buzzy') || asset.id.includes('butterfly') || asset.id.includes('ladybird')) {
        node.position = [position[0], 0.6, position[2]];
      }
      target.nodes.push(node);
      store.set({ selectedNodeId: node.id });
    }, { rebuild: true });
    store.notify(`Added ${asset.name}`, 'good');
  };

  // The viewport tells us where the drop landed on the ground plane.
  useDropListener(addNode);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Library</h2>
        <input
          className="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint">{TABS.find((t) => t.id === tab)?.hint}</p>

      {tab === 'sets' ? (
        <div className="card-grid">
          {ENVIRONMENTS.filter((e) => match(e.name, e.description)).map((env) => (
            <button
              key={env.theme}
              className={scene?.environment.theme === env.theme ? 'card on' : 'card'}
              onClick={() => {
                store.edit((project) => {
                  const target = project.scenes.find((s) => s.id === sceneId);
                  if (target) target.environment = { ...target.environment, theme: env.theme };
                }, { rebuild: true });
                store.notify(`Set changed to ${env.name}`, 'good');
              }}
            >
              <span className="card-title">{env.name}</span>
              <span className="card-desc">{env.description}</span>
            </button>
          ))}
          <div className="card-note">
            <strong>Seed {scene?.environment.seed}</strong>
            <p>Every set is generated from a seed. Change it for a different arrangement of the same place.</p>
            <div className="row">
              <button
                className="btn"
                onClick={() => store.edit((project) => {
                  const target = project.scenes.find((s) => s.id === sceneId);
                  if (target) target.environment.seed = Math.floor(Math.random() * 9999) + 1;
                }, { rebuild: true })}
              >
                Shuffle the set
              </button>
            </div>
          </div>
        </div>
      ) : tab === 'actions' ? (
        <ActionList nodeId={selectedNodeId} time={time} />
      ) : (
        <div className="card-grid">
          {items.map((item) => (
            <div
              key={item.id}
              className="card draggable"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/bloom-asset',
                  JSON.stringify({ id: item.id, kind: item.kind, name: item.name }),
                );
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => addNode({ id: item.id, kind: item.kind, name: item.name }, [0, 0, 0])}
              title={`${item.description}\n\nDrag onto the stage, or double-click to drop it in the middle.`}
            >
              <span className="card-title">{item.name}</span>
              <span className="card-desc">{item.description}</span>
            </div>
          ))}
          {!items.length && <p className="empty">Nothing matches “{query}”.</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function ActionList({ nodeId, time }: { nodeId: string | null; time: number }) {
  const [duration, setDuration] = useState(1.5);
  if (!nodeId) {
    return <p className="empty">Select a character on the stage first, then pick an action.</p>;
  }
  const groups = ['gesture', 'body', 'head', 'reaction', 'flight'] as const;
  return (
    <div className="action-list">
      <label className="field inline">
        <span>Length</span>
        <input
          type="range" min={0.4} max={6} step={0.1}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        />
        <output>{duration.toFixed(1)}s</output>
      </label>
      <p className="hint">
        The action is added at the playhead ({time.toFixed(2)}s) and layers on top of whatever is already there.
      </p>
      {groups.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <div className="chip-grid">
            {ACTIONS.filter((a) => a.category === group).map((action) => (
              <button
                key={action.id}
                className="chip"
                title={action.hint}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bloom:add-action', {
                    detail: { nodeId, action: action.id, start: time, duration },
                  }));
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drops from the viewport
 * ------------------------------------------------------------------ */

function useDropListener(
  add: (asset: { id: string; kind: string; name: string }, position: [number, number, number]) => void,
) {
  // The handler is recreated every render (it closes over the current scene id),
  // so it is held in a ref and the listener is registered once. Re-registering
  // each render would churn listeners on the window.
  const latest = useRef(add);
  latest.current = add;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        asset: { id: string; kind: string; name: string };
        position: [number, number, number];
      };
      latest.current(detail.asset, detail.position);
    };
    window.addEventListener('bloom:drop-asset', handler);
    return () => window.removeEventListener('bloom:drop-asset', handler);
  }, []);
}
