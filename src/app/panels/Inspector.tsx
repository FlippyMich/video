/**
 * The inspector.
 *
 * Properties for whatever is selected — a character, a prop, the shot, or the
 * scene. Everything here is a plain labelled control; there are no gizmos to
 * learn and no modes to be in.
 */

import { CHARACTER_BY_ID } from '../../engine/assets/characters';
import { ENVIRONMENTS } from '../../engine/assets/environments';
import { EXPRESSION_IDS, EXPRESSION_LABELS } from '../../engine/rig/expressions';
import { FRAMING_LABELS, MOVE_LABELS } from '../../engine/render/director';
import type { CameraMove, FramingPreset, LightingPreset, SceneDoc, SceneNode, Shot, ShotEffectType, TransitionType } from '../../engine/types';
import { SKIN_TONES, HAIR_COLOURS, SHIRT_COLOURS, PALETTE } from '../../engine/assets/palette';
import { setKey } from '../../engine/anim/keyframes';
import { store } from '../store';
import { useEditor } from '../useEditor';

const LIGHTING: { id: LightingPreset; label: string }[] = [
  { id: 'sunny', label: 'Bright sunshine' },
  { id: 'soft-day', label: 'Soft daylight' },
  { id: 'golden-hour', label: 'Golden hour' },
  { id: 'indoor-warm', label: 'Warm indoors' },
  { id: 'night-moon', label: 'Moonlight' },
  { id: 'stage', label: 'Stage lights' },
  { id: 'flat-key', label: 'Flat (for green screen)' },
];

const EFFECTS: { id: ShotEffectType; label: string }[] = [
  { id: 'vignette', label: 'Vignette' },
  { id: 'saturate', label: 'More colour' },
  { id: 'desaturate', label: 'Less colour' },
  { id: 'warm', label: 'Warmer' },
  { id: 'cool', label: 'Cooler' },
  { id: 'zoom-punch', label: 'Zoom punch' },
  { id: 'shake', label: 'Shake' },
  { id: 'sparkle-overlay', label: 'Sparkle overlay' },
  { id: 'bloom-boost', label: 'Glow' },
];

const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'cut', label: 'Cut (instant)' },
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'fade-to-black', label: 'Fade through black' },
  { id: 'fade-to-white', label: 'Fade through white' },
  { id: 'wipe-left', label: 'Wipe' },
  { id: 'iris', label: 'Iris' },
  { id: 'whip-pan', label: 'Whip pan' },
];

export function Inspector() {
  const { scene, node, shot, time } = useEditor((s) => ({
    scene: s.project.scenes.find((x) => x.id === s.selectedSceneId),
    node: s.project.scenes.find((x) => x.id === s.selectedSceneId)?.nodes.find((n) => n.id === s.selectedNodeId),
    shot: s.project.sequence.find((x) => x.id === s.selectedShotId),
    time: s.time,
  }));

  return (
    <div className="panel inspector">
      {node ? <NodeInspector node={node} time={time} /> : <p className="empty">Click something on the stage to change it.</p>}
      {shot && <ShotInspector shot={shot} />}
      {scene && <SceneInspector scene={scene} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Node
 * ------------------------------------------------------------------ */

function NodeInspector({ node, time }: { node: SceneNode; time: number }) {
  const isCharacter = node.kind === 'character';
  const def = isCharacter ? CHARACTER_BY_ID.get(node.assetId) : null;
  const params = (node.params ?? {}) as Record<string, number | string>;

  const patch = (fn: (n: SceneNode) => void, rebuild = false) => {
    store.edit((project) => {
      for (const scene of project.scenes) {
        const target = scene.nodes.find((n) => n.id === node.id);
        if (target) { fn(target); return; }
      }
    }, { rebuild, coalesce: 350 });
  };

  return (
    <section className="group">
      <header className="group-head">
        <input
          className="name-field"
          value={node.name}
          onChange={(e) => patch((n) => { n.name = e.target.value; })}
        />
        <button
          className="btn danger small"
          title="Remove from the scene"
          onClick={() => {
            store.edit((project) => {
              for (const scene of project.scenes) {
                const i = scene.nodes.findIndex((n) => n.id === node.id);
                if (i >= 0) { scene.nodes.splice(i, 1); return; }
              }
            }, { rebuild: true });
            store.set({ selectedNodeId: null });
          }}
        >
          Remove
        </button>
      </header>
      {def && <p className="hint">{def.description}</p>}

      <Vec3Field
        label="Position"
        hint="Left/right, up/down, forwards/back"
        value={node.position}
        step={0.05}
        onChange={(v) => patch((n) => { n.position = v; })}
      />
      <Vec3Field
        label="Turn"
        hint="Rotation, in degrees"
        value={node.rotation.map((r) => (r * 180) / Math.PI) as [number, number, number]}
        step={5}
        onChange={(v) => patch((n) => { n.rotation = v.map((d) => (d * Math.PI) / 180) as [number, number, number]; })}
      />
      <label className="field">
        <span>Size</span>
        <input
          type="range" min={0.2} max={3} step={0.05}
          value={node.scale[0]}
          onChange={(e) => {
            const v = Number(e.target.value);
            patch((n) => { n.scale = [v, v, v]; });
          }}
        />
        <output>{node.scale[0].toFixed(2)}×</output>
      </label>

      {isCharacter && (
        <>
          <h4>Look</h4>
          {def?.rigFamily === 'biped' && node.assetId.includes('kid') || node.assetId.includes('adult') ? (
            <>
              <SwatchField label="Skin" colours={SKIN_TONES} value={Number(params.skin ?? 0)} onPick={(c) => patch((n) => { n.params = { ...n.params, skin: c }; }, true)} />
              <SwatchField label="Hair" colours={HAIR_COLOURS} value={Number(params.hair ?? 0)} onPick={(c) => patch((n) => { n.params = { ...n.params, hair: c }; }, true)} />
              <SwatchField label="Top" colours={SHIRT_COLOURS} value={Number(params.shirt ?? 0)} onPick={(c) => patch((n) => { n.params = { ...n.params, shirt: c }; }, true)} />
              <label className="field">
                <span>Hair style</span>
                <select
                  value={String(params.hairStyle ?? 'short')}
                  onChange={(e) => patch((n) => { n.params = { ...n.params, hairStyle: e.target.value }; }, true)}
                >
                  {['short', 'bunches', 'bob', 'curly', 'ponytail', 'bun', 'bald'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <SwatchField
              label="Colour"
              colours={[PALETTE.honey, PALETTE.strawberry, PALETTE.leaf, PALETTE.skyDeep, PALETTE.petalPurple, PALETTE.orange, PALETTE.mint, PALETTE.petalPink]}
              value={Number(params.bodyColor ?? 0)}
              onPick={(c) => patch((n) => { n.params = { ...n.params, bodyColor: c }; }, true)}
            />
          )}

          <h4>Face</h4>
          <p className="hint">Sets the expression at the playhead ({time.toFixed(2)}s).</p>
          <div className="chip-grid">
            {EXPRESSION_IDS.map((id) => (
              <button
                key={id}
                className="chip"
                onClick={() => {
                  store.edit((project) => {
                    for (const scene of project.scenes) {
                      const target = scene.nodes.find((n) => n.id === node.id);
                      if (!target) continue;
                      target.tracks ??= [];
                      // One expression at a time: fade the others out where this
                      // one starts, or two poses fight over the same face.
                      for (const other of EXPRESSION_IDS) {
                        const channel = `expression.${other}`;
                        let track = target.tracks.find((t) => t.channel === channel);
                        if (other === id) {
                          if (!track) { track = { channel, keys: [] }; target.tracks.push(track); }
                          setKey(track.keys, Math.max(0, time - 0.25), 0, 'easeInOut');
                          setKey(track.keys, time, 1);
                        } else if (track) {
                          setKey(track.keys, time, 0, 'easeInOut');
                        }
                      }
                      return;
                    }
                  });
                  store.notify(`${EXPRESSION_LABELS[id]} at ${time.toFixed(2)}s`, 'good');
                }}
              >
                {EXPRESSION_LABELS[id]}
              </button>
            ))}
          </div>
        </>
      )}

      {node.kind === 'text' && (
        <label className="field">
          <span>Words</span>
          <textarea
            rows={2}
            value={String(params.text ?? '')}
            onChange={(e) => patch((n) => { n.params = { ...n.params, text: e.target.value }; }, true)}
          />
        </label>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Shot
 * ------------------------------------------------------------------ */

function ShotInspector({ shot }: { shot: Shot }) {
  const nodes = useEditor((s) => s.project.scenes.find((x) => x.id === shot.sceneId)?.nodes ?? []);
  const patch = (fn: (s: typeof shot) => void) => {
    store.edit((project) => {
      const target = project.sequence.find((s) => s.id === shot.id);
      if (target) fn(target);
    }, { coalesce: 300 });
  };

  const effect = (type: ShotEffectType) => shot.effects?.find((e) => e.type === type);

  return (
    <section className="group">
      <h3>This shot</h3>
      <label className="field">
        <span>Framing</span>
        <select value={shot.framing ?? 'medium'} onChange={(e) => patch((s) => { s.framing = e.target.value as FramingPreset; })}>
          {Object.entries(FRAMING_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Points at</span>
        <select value={shot.targetNodeId ?? ''} onChange={(e) => patch((s) => { s.targetNodeId = e.target.value || undefined; })}>
          <option value="">— nothing in particular —</option>
          {nodes.filter((n) => n.kind === 'character' || n.kind === 'prop').map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Camera move</span>
        <select value={shot.move ?? 'static'} onChange={(e) => patch((s) => { s.move = e.target.value as CameraMove; })}>
          {Object.entries(MOVE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Move amount</span>
        <input
          type="range" min={0} max={1.6} step={0.05}
          value={shot.moveAmount ?? 1}
          onChange={(e) => patch((s) => { s.moveAmount = Number(e.target.value); })}
        />
        <output>{(shot.moveAmount ?? 1).toFixed(2)}</output>
      </label>
      <label className="field">
        <span>Starts with</span>
        <select
          value={shot.transitionIn?.type ?? 'cut'}
          onChange={(e) => patch((s) => {
            const type = e.target.value as TransitionType;
            s.transitionIn = type === 'cut' ? undefined : { type, duration: s.transitionIn?.duration ?? 0.4 };
          })}
        >
          {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {shot.transitionIn && (
        <label className="field">
          <span>Transition length</span>
          <input
            type="range" min={0.1} max={2} step={0.05}
            value={shot.transitionIn.duration}
            onChange={(e) => patch((s) => { if (s.transitionIn) s.transitionIn.duration = Number(e.target.value); })}
          />
          <output>{shot.transitionIn.duration.toFixed(2)}s</output>
        </label>
      )}

      <h4>Effects</h4>
      <div className="effect-list">
        {EFFECTS.map((fx) => {
          const active = effect(fx.id);
          return (
            <div key={fx.id} className="effect-row">
              <label className="tool-check">
                <input
                  type="checkbox"
                  checked={!!active}
                  onChange={(e) => patch((s) => {
                    s.effects ??= [];
                    if (e.target.checked) s.effects.push({ type: fx.id, amount: 0.5 });
                    else s.effects = s.effects.filter((x) => x.type !== fx.id);
                  })}
                />
                {fx.label}
              </label>
              {active && (
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={active.amount}
                  onChange={(e) => patch((s) => {
                    const t = s.effects?.find((x) => x.type === fx.id);
                    if (t) t.amount = Number(e.target.value);
                  })}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

function SceneInspector({ scene }: { scene: SceneDoc }) {
  const patch = (fn: (s: typeof scene) => void, rebuild = true) => {
    store.edit((project) => {
      const target = project.scenes.find((s) => s.id === scene.id);
      if (target) fn(target);
    }, { rebuild, coalesce: 300 });
  };

  return (
    <section className="group">
      <h3>This scene</h3>
      <label className="field">
        <span>Name</span>
        <input value={scene.name} onChange={(e) => patch((s) => { s.name = e.target.value; }, false)} />
      </label>
      <label className="field">
        <span>Place</span>
        <select
          value={scene.environment.theme}
          onChange={(e) => patch((s) => { s.environment.theme = e.target.value as typeof s.environment.theme; })}
        >
          {ENVIRONMENTS.map((env) => <option key={env.theme} value={env.theme}>{env.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Time of day</span>
        <select
          value={scene.environment.timeOfDay ?? 'noon'}
          onChange={(e) => patch((s) => { s.environment.timeOfDay = e.target.value as typeof s.environment.timeOfDay; })}
        >
          {['morning', 'noon', 'afternoon', 'sunset', 'night'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Weather</span>
        <select
          value={scene.environment.weather ?? 'clear'}
          onChange={(e) => patch((s) => { s.environment.weather = e.target.value as typeof s.environment.weather; })}
        >
          {['clear', 'cloudy', 'rainbow'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Lighting</span>
        <select
          value={scene.lighting}
          onChange={(e) => patch((s) => { s.lighting = e.target.value as LightingPreset; })}
        >
          {LIGHTING.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>How busy</span>
        <input
          type="range" min={0.1} max={1} step={0.05}
          value={scene.environment.density ?? 0.6}
          onChange={(e) => patch((s) => { s.environment.density = Number(e.target.value); })}
        />
        <output>{Math.round((scene.environment.density ?? 0.6) * 100)}%</output>
      </label>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Small controls
 * ------------------------------------------------------------------ */

function Vec3Field({
  label, hint, value, step, onChange,
}: {
  label: string;
  hint?: string;
  value: [number, number, number];
  step: number;
  onChange: (v: [number, number, number]) => void;
}) {
  return (
    <div className="field vec3">
      <span title={hint}>{label}</span>
      <div className="vec3-inputs">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <label key={axis}>
            <em>{axis}</em>
            <input
              type="number"
              step={step}
              value={Number(value[i].toFixed(3))}
              onChange={(e) => {
                const next = [...value] as [number, number, number];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SwatchField({
  label, colours, value, onPick,
}: {
  label: string;
  colours: readonly number[];
  value: number;
  onPick: (c: number) => void;
}) {
  return (
    <div className="field swatches">
      <span>{label}</span>
      <div className="swatch-row">
        {colours.map((c) => (
          <button
            key={c}
            className={value === c ? 'swatch on' : 'swatch'}
            style={{ background: `#${c.toString(16).padStart(6, '0')}` }}
            onClick={() => onPick(c)}
            aria-label={`#${c.toString(16).padStart(6, '0')}`}
          />
        ))}
      </div>
    </div>
  );
}
