/**
 * Script import.
 *
 * Paste a script, press one button, get a finished film: staged characters,
 * performances, lip-sync, cut cameras and captions. This is the fastest route
 * from an idea to something watchable, and for most users it is the only route
 * they will ever need — everything the importer produces is ordinary editable
 * keyframes afterwards.
 */

import { useMemo, useRef, useState } from 'react';
import { parseScript } from '../../engine/script/parser';
import { autoCast, type CastMember } from '../../engine/script/builder';
import { buildInWorker } from '../../engine/workers/build-client';
import { CHARACTERS } from '../../engine/assets/characters';
import { store } from '../store';

const EXAMPLE = `# Title: A Very Good Morning

## Scene: The garden | theme=garden time=morning

[Buzzy flies in and waves]
BUZZY (excited): Good morning, everybody! It's me, Buzzy!
?? Can you wave back? | 3s | hand-icon | Hello!
LILY (happy): Morning, Buzzy! What shall we do today?
BUZZY (curious): Let's go and find something yellow. Ready?
@sfx: sparkle
?? Point at something yellow! | 3s | countdown | Yellow!
LILY (excited): I found a sunflower!
BUZZY (proud): Brilliant looking. Well done, everybody!
~~ crossfade 0.5

## Scene: The pond | theme=pond time=afternoon

@music: gentle-morning
[Buzzy lands on a lily pad]
BUZZY (happy): Listen. Can you hear the water?
`;

export function ScriptPanel() {
  const [text, setText] = useState(EXAMPLE);
  const [bookends, setBookends] = useState(true);
  const [wpm, setWpm] = useState(138);
  const [castOverrides, setCastOverrides] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, script: parseScript(text) };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  }, [text]);

  const cast = useMemo(
    () => (parsed.ok ? autoCast(parsed.script) : []),
    [parsed],
  );

  const stats = useMemo(() => {
    if (!parsed.ok) return null;
    const s = parsed.script;
    let lines = 0;
    let beats = 0;
    let cues = 0;
    for (const scene of s.scenes) {
      for (const beat of scene.beats) {
        if (beat.type === 'dialogue') lines++;
        else if (beat.type === 'interaction') beats++;
        else if (beat.type === 'sfx' || beat.type === 'music') cues++;
      }
    }
    return { scenes: s.scenes.length, lines, beats, cues, cast: s.cast.length, warnings: s.warnings };
  }, [parsed]);

  const build = async () => {
    if (!parsed.ok || building) return;
    setBuilding(true);
    const overrides: CastMember[] = cast.map((c) => ({
      ...c,
      assetId: castOverrides[c.name] ?? c.assetId,
    }));
    try {
      // Off the main thread: a full film is well over a hundred thousand
      // keyframes, and baking that inline freezes the whole editor for long
      // enough that people click the button twice.
      const result = await buildInWorker(text, { cast: overrides, bookends, wpm });
      store.loadProject(
        result.project,
        `Built ${result.stats.scenes} scenes and ${result.stats.shots} shots ` +
        `(${result.stats.keyframes.toLocaleString()} keyframes) in ${(result.ms / 1000).toFixed(1)}s.`,
      );
    } catch (err) {
      store.notify(`Could not build the film: ${(err as Error).message}`, 'warn');
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="panel script-panel">
      <div className="panel-head">
        <h2>Script</h2>
        <div className="row">
          <button className="btn ghost small" onClick={() => fileRef.current?.click()}>Open file…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.fountain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setText(await file.text());
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <p className="hint">
        Write <code>NAME: what they say</code> for dialogue, <code>[something happens]</code> for an action,
        and <code>?? A question for the children</code> for a pause. Everything else is optional.
      </p>

      <textarea
        className="script-editor"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />

      {stats && (
        <div className="stat-row">
          <Stat n={stats.scenes} label="scenes" />
          <Stat n={stats.lines} label="lines" />
          <Stat n={stats.beats} label="audience beats" />
          <Stat n={stats.cues} label="sound cues" />
        </div>
      )}

      {stats?.warnings.length ? (
        <div className="warnings">
          {stats.warnings.slice(0, 6).map((w, i) => (
            <p key={i}><strong>Line {w.line}</strong> {w.message}</p>
          ))}
          {stats.warnings.length > 6 && <p>…and {stats.warnings.length - 6} more.</p>}
        </div>
      ) : null}

      {cast.length > 0 && (
        <section className="group">
          <h3>Who plays who</h3>
          <p className="hint">Guessed from the names. Change any of them.</p>
          {cast.map((member) => (
            <label key={member.name} className="field">
              <span>{member.displayName}</span>
              <select
                value={castOverrides[member.name] ?? member.assetId}
                onChange={(e) => setCastOverrides((prev) => ({ ...prev, [member.name]: e.target.value }))}
              >
                {CHARACTERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ))}
        </section>
      )}

      <section className="group">
        <h3>Options</h3>
        <label className="tool-check">
          <input type="checkbox" checked={bookends} onChange={(e) => setBookends(e.target.checked)} />
          Add an animated title card and an outro
        </label>
        <label className="field">
          <span>Reading speed</span>
          <input type="range" min={100} max={180} step={2} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} />
          <output>{wpm} wpm</output>
        </label>
        <p className="hint">
          Line lengths are estimated from the text. When you add real recordings, the timing is taken
          from the audio instead.
        </p>
      </section>

      <div className="row sticky-actions">
        <button className="btn primary big" disabled={!parsed.ok || building} onClick={build}>
          {building ? 'Building…' : 'Build the film'}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            const current = store.getState().project.scriptSource;
            if (current) setText(current);
            else store.notify('This project was not made from a script.', 'warn');
          }}
        >
          Load the current film’s script
        </button>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}
