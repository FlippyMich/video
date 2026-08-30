/**
 * The timeline.
 *
 * Four kinds of lane: the shot strip, audio tracks, the audience beats, and the
 * animation channels of whatever is selected. Drag a shot edge to retime it,
 * drag a keyframe to move it, click the ruler to scrub.
 *
 * Everything is laid out in seconds and converted to pixels once, through
 * `pxPerSecond`, so zooming is a single number change rather than a rewrite of
 * every position.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimTrack, Project } from '../../engine/types';
import { snapToFrame } from '../../engine/anim/keyframes';
import { store, uid } from '../store';
import { useEditor } from '../useEditor';

const LANE_H = 26;
const HEADER_W = 148;

export function Timeline() {
  const { project, time, playing, selectedNodeId, selectedShotId } = useEditor((s) => ({
    project: s.project,
    time: s.time,
    playing: s.playing,
    selectedNodeId: s.selectedNodeId,
    selectedShotId: s.selectedShotId,
  }));

  const [zoom, setZoom] = useState(70);
  const scrollRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, project.meta.duration);
  const width = duration * zoom;

  const node = project.scenes.flatMap((s) => s.nodes).find((n) => n.id === selectedNodeId);
  const tracks = (node?.tracks ?? []).filter((t) => t.keys.length > 0);

  /* Keep the playhead on screen while the film plays. */
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = time * zoom;
    const left = el.scrollLeft;
    const right = left + el.clientWidth - HEADER_W;
    if (x < left + 40 || x > right - 120) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.35);
  }, [time, playing, zoom]);

  const scrubFromEvent = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - HEADER_W;
    const t = Math.max(0, Math.min(duration, x / zoom));
    store.set({ time: snapToFrame(t, project.meta.fps), playing: false });
  }, [duration, zoom, project.meta.fps]);

  return (
    <div className="timeline">
      <Transport time={time} duration={duration} playing={playing} fps={project.meta.fps} zoom={zoom} setZoom={setZoom} />

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-body" style={{ width: width + HEADER_W }}>
          <Ruler duration={duration} zoom={zoom} onScrub={scrubFromEvent} />

          <Lane label="Shots" hint="Each block is one camera setup. Drag the right edge to retime it.">
            <ShotStrip project={project} zoom={zoom} selectedShotId={selectedShotId} />
          </Lane>

          {(['dialogue', 'music', 'sfx'] as const).map((role) => {
            const clips = project.audio.filter((a) => a.role === role);
            if (!clips.length) return null;
            return (
              <Lane key={role} label={role === 'sfx' ? 'Sound FX' : role === 'music' ? 'Music' : 'Voices'}>
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={`clip audio ${role}`}
                    style={{ left: clip.start * zoom, width: Math.max(3, clip.duration * zoom) }}
                    title={`${clip.label ?? clip.src}\n${clip.start.toFixed(2)}s for ${clip.duration.toFixed(2)}s`}
                    onClick={() => store.set({ time: clip.start + 0.02, playing: false })}
                  >
                    <span>{clip.label ?? clip.src.split('/').pop()}</span>
                  </div>
                ))}
              </Lane>
            );
          })}

          {project.interactions.length > 0 && (
            <Lane label="Audience" hint="Pauses where the children answer, sing or copy a gesture.">
              {project.interactions.map((beat) => (
                <div
                  key={beat.id}
                  className="clip beat"
                  style={{ left: beat.start * zoom, width: Math.max(3, beat.duration * zoom) }}
                  title={`${beat.prompt}\nHolds ${beat.duration.toFixed(1)}s`}
                  onClick={() => store.set({ time: beat.start + 0.02, playing: false })}
                >
                  <span>{beat.prompt}</span>
                </div>
              ))}
            </Lane>
          )}

          {project.subtitles.length > 0 && (
            <Lane label="Captions">
              {project.subtitles.map((cue) => (
                <div
                  key={cue.id}
                  className="clip caption"
                  style={{ left: cue.start * zoom, width: Math.max(3, (cue.end - cue.start) * zoom) }}
                  title={cue.text}
                  onClick={() => store.set({ time: cue.start + 0.02, playing: false })}
                >
                  <span>{cue.text.replace(/\n/g, ' ')}</span>
                </div>
              ))}
            </Lane>
          )}

          {node && (
            <>
              <div className="lane-divider">
                <span>{node.name}</span>
                {tracks.length > 0 && (
                  <button
                    className="btn small ghost"
                    title="Delete every keyframe on this character"
                    onClick={() => {
                      store.edit((p) => {
                        for (const scene of p.scenes) {
                          const t = scene.nodes.find((n) => n.id === node.id);
                          if (t) { t.tracks = []; return; }
                        }
                      });
                      store.notify(`Cleared the animation on ${node.name}`, 'warn');
                    }}
                  >
                    Clear animation
                  </button>
                )}
              </div>
              {tracks.length === 0 && (
                <p className="empty small">
                  No animation yet. Open <strong>Library → Actions</strong> and click something.
                </p>
              )}
              {tracks.map((track) => (
                <KeyLane key={track.channel} nodeId={node.id} track={track} zoom={zoom} time={time} fps={project.meta.fps} />
              ))}
            </>
          )}

          <div className="playhead" style={{ left: HEADER_W + time * zoom }}>
            <div className="playhead-grip" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

function Transport({
  time, duration, playing, fps, zoom, setZoom,
}: {
  time: number; duration: number; playing: boolean; fps: number;
  zoom: number; setZoom: (n: number) => void;
}) {
  const step = (frames: number) =>
    store.set({ time: Math.max(0, Math.min(duration, snapToFrame(time + frames / fps, fps))), playing: false });

  return (
    <div className="transport">
      <button className="btn" onClick={() => store.set({ time: 0, playing: false })} title="Back to the start (Home)">⏮</button>
      <button className="btn" onClick={() => step(-1)} title="One frame back (←)">◀|</button>
      <button
        className="btn primary"
        onClick={() => store.set({ playing: !playing, time: time >= duration - 0.01 ? 0 : time })}
        title="Play or pause (Space)"
      >
        {playing ? '❚❚  Pause' : '▶  Play'}
      </button>
      <button className="btn" onClick={() => step(1)} title="One frame forward (→)">|▶</button>
      <span className="timecode">
        {formatTime(time)} <em>/ {formatTime(duration)}</em>
      </span>
      <span className="tool-spacer" />
      <label className="tool-check">
        Zoom
        <input type="range" min={18} max={260} step={2} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </label>
    </div>
  );
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Ruler and lanes
 * ------------------------------------------------------------------ */

function Ruler({ duration, zoom, onScrub }: { duration: number; zoom: number; onScrub: (x: number) => void }) {
  // Pick a tick spacing that keeps labels at least 56px apart at any zoom.
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = candidates.find((c) => c * zoom > 56) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);

  return (
    <div
      className="ruler"
      style={{ marginLeft: HEADER_W }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onScrub(e.clientX);
      }}
      onPointerMove={(e) => { if (e.buttons === 1) onScrub(e.clientX); }}
    >
      {ticks.map((t) => (
        <span key={t} className="tick" style={{ left: t * zoom }}>
          {formatTime(t)}
        </span>
      ))}
    </div>
  );
}

function Lane({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="lane">
      <div className="lane-head" title={hint} style={{ width: HEADER_W }}>{label}</div>
      <div className="lane-body" style={{ height: LANE_H }}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shots
 * ------------------------------------------------------------------ */

function ShotStrip({ project, zoom, selectedShotId }: { project: Project; zoom: number; selectedShotId: string | null }) {
  const dragRef = useRef<{ id: string; startX: number; startDuration: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (e.clientX - d.startX) / zoom;
      store.edit((p) => {
        const i = p.sequence.findIndex((s) => s.id === d.id);
        if (i < 0) return;
        const shot = p.sequence[i];
        const next = Math.max(0.2, snapToFrame(d.startDuration + delta, p.meta.fps));
        const shift = next - shot.duration;
        shot.duration = next;
        // Everything after slides along: shots in a sequence are contiguous, and
        // leaving a gap would show a frozen frame in the export.
        for (let k = i + 1; k < p.sequence.length; k++) p.sequence[k].start += shift;
      }, { coalesce: 120 });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [zoom]);

  const sceneName = new Map(project.scenes.map((s) => [s.id, s.name]));

  return (
    <>
      {project.sequence.map((shot, i) => (
        <div
          key={shot.id}
          className={`clip shot${shot.id === selectedShotId ? ' on' : ''}`}
          style={{ left: shot.start * zoom, width: Math.max(6, shot.duration * zoom) }}
          title={`${i + 1}. ${sceneName.get(shot.sceneId)} — ${shot.framing ?? 'camera'}\n${shot.note ?? ''}`}
          onClick={() => store.set({
            selectedShotId: shot.id,
            selectedSceneId: shot.sceneId,
            time: shot.start + 0.02,
            playing: false,
          })}
        >
          <span>{i + 1}. {shot.framing ?? 'camera'}</span>
          <i
            className="clip-handle"
            title="Drag to make this shot longer or shorter"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { id: shot.id, startX: e.clientX, startDuration: shot.duration };
            }}
          />
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Keyframes
 * ------------------------------------------------------------------ */

function KeyLane({
  nodeId, track, zoom, time, fps,
}: {
  nodeId: string; track: AnimTrack; zoom: number; time: number; fps: number;
}) {
  const dragRef = useRef<{ index: number; startX: number; startT: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (e.clientX - d.startX) / zoom;
      store.edit((p) => {
        for (const scene of p.scenes) {
          const n = scene.nodes.find((x) => x.id === nodeId);
          if (!n) continue;
          const t = n.tracks?.find((x) => x.channel === track.channel);
          if (!t) return;
          t.keys[d.index].t = Math.max(0, snapToFrame(d.startT + delta, fps));
          t.keys.sort((a, b) => a.t - b.t);
          return;
        }
      }, { coalesce: 100 });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [nodeId, track.channel, zoom, fps]);

  // Tracks baked from an action can carry hundreds of keys; drawing every one
  // makes a solid bar nobody can hit. Above a threshold, show the span instead.
  const dense = track.keys.length > 90;

  return (
    <div className={`lane key-lane${track.muted ? ' muted' : ''}`}>
      <div
        className="lane-head"
        style={{ width: HEADER_W }}
        title={`${track.channel}\n${track.keys.length} keyframes\nClick to mute`}
        onClick={() => store.edit((p) => {
          for (const scene of p.scenes) {
            const n = scene.nodes.find((x) => x.id === nodeId);
            const t = n?.tracks?.find((x) => x.channel === track.channel);
            if (t) { t.muted = !t.muted; return; }
          }
        })}
      >
        {prettyChannel(track.channel)}
      </div>
      <div className="lane-body" style={{ height: LANE_H }}>
        {dense ? (
          <div
            className="key-span"
            style={{
              left: track.keys[0].t * zoom,
              width: Math.max(4, (track.keys[track.keys.length - 1].t - track.keys[0].t) * zoom),
            }}
            title={`${track.keys.length} keyframes — baked from an action`}
          />
        ) : (
          track.keys.map((key, i) => (
            <i
              key={i}
              className={`key${Math.abs(key.t - time) < 0.03 ? ' on' : ''}`}
              style={{ left: key.t * zoom }}
              title={`${key.t.toFixed(2)}s = ${key.v.toFixed(3)}\nDrag to move, double-click to delete`}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = { index: i, startX: e.clientX, startT: key.t };
                store.set({ time: key.t, playing: false });
              }}
              onDoubleClick={() => store.edit((p) => {
                for (const scene of p.scenes) {
                  const n = scene.nodes.find((x) => x.id === nodeId);
                  const t = n?.tracks?.find((x) => x.channel === track.channel);
                  if (t) { t.keys.splice(i, 1); return; }
                }
              })}
            />
          ))
        )}
      </div>
    </div>
  );
}

const JOINT_WORDS: Record<string, string> = {
  rx: 'nod', ry: 'turn', rz: 'tilt',
};

function prettyChannel(channel: string): string {
  if (channel.startsWith('viseme.')) return `mouth · ${channel.slice(7)}`;
  if (channel.startsWith('expression.')) return `face · ${channel.slice(11)}`;
  if (channel === 'blink') return 'blink';
  if (channel.startsWith('rig.')) {
    const [, joint, axis] = channel.split('.');
    const readable = joint.replace(/([A-Z])/g, ' $1').toLowerCase();
    return `${readable} ${JOINT_WORDS[axis] ?? axis}`;
  }
  return channel.replace('.', ' ');
}

/** Exported so the App can add a keyframe from a shortcut. */
export function addKeyAtPlayhead(project: Project, nodeId: string, channel: string, value: number, time: number) {
  void project;
  store.edit((p) => {
    for (const scene of p.scenes) {
      const n = scene.nodes.find((x) => x.id === nodeId);
      if (!n) continue;
      n.tracks ??= [];
      let track = n.tracks.find((t) => t.channel === channel);
      if (!track) { track = { channel, keys: [] }; n.tracks.push(track); }
      const i = track.keys.findIndex((k) => Math.abs(k.t - time) < 1e-3);
      if (i >= 0) track.keys[i].v = value;
      else {
        track.keys.push({ t: time, v: value });
        track.keys.sort((a, b) => a.t - b.t);
      }
      return;
    }
  });
}

export { uid };
