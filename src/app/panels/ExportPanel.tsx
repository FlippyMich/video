/**
 * Export.
 *
 * Presets for the places these videos actually go, and honest numbers: how long
 * the render will take and roughly how big the file will be. A render that says
 * nothing for twenty minutes is a render people cancel.
 */

import { useRef, useState } from 'react';
import { EXPORT_PRESETS, type ExportPreset } from '../../engine/types';
import { canExportVideo, exportStill, exportVideo, subtitlesToVTT } from '../../engine/render/exporter';
import { store } from '../store';
import { useEditor } from '../useEditor';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportPanel() {
  const { project, time } = useEditor((s) => ({ project: s.project, time: s.time }));
  const [presetId, setPresetId] = useState('youtube-1080p');
  const [burnCaptions, setBurnCaptions] = useState(false);
  const [overlays, setOverlays] = useState(true);
  const [range, setRange] = useState<'all' | 'shot'>('all');
  const [progress, setProgress] = useState<{ done: number; total: number; fps: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? EXPORT_PRESETS[0];
  const shot = project.sequence.find((s) => time >= s.start && time < s.start + s.duration);
  const from = range === 'shot' && shot ? shot.start : 0;
  const to = range === 'shot' && shot ? shot.start + shot.duration : project.meta.duration;
  const frames = Math.round((to - from) * preset.fps);
  const estimateMb = ((preset.bitrate / 8) * (to - from)) / 1024 / 1024;
  const supported = canExportVideo();

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: frames, fps: 0 });
    try {
      const result = await exportVideo(project, {
        preset,
        subtitles: burnCaptions,
        overlays,
        from,
        to,
        signal: controller.signal,
        onProgress: (done, total, fps) => setProgress({ done, total, fps }),
      });
      download(result.blob, result.filename);
      store.notify(
        `Exported ${result.frames} frames in ${result.seconds.toFixed(0)}s — check your downloads.`,
        'good',
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') store.notify('Export cancelled.', 'warn');
      else store.notify(`Export failed: ${(err as Error).message}`, 'warn');
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="panel">
      <div className="panel-head"><h2>Export</h2></div>

      {!supported && (
        <div className="warnings">
          <p>
            This browser can’t encode video. Chrome, Edge and Safari 16.4 or newer can.
            Everything else on this page still works.
          </p>
        </div>
      )}

      <section className="group">
        <h3>Where is it going?</h3>
        <div className="preset-list">
          {EXPORT_PRESETS.map((p) => (
            <PresetRow key={p.id} preset={p} selected={p.id === presetId} onSelect={() => setPresetId(p.id)} />
          ))}
        </div>
      </section>

      <section className="group">
        <h3>Options</h3>
        <label className="tool-check">
          <input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} />
          Burn the captions into the picture
        </label>
        <p className="hint">
          Leave this off for YouTube and upload the subtitle file instead — viewers can then turn them
          on or off, and YouTube can translate them.
        </p>
        <label className="tool-check">
          <input type="checkbox" checked={overlays} onChange={(e) => setOverlays(e.target.checked)} />
          Include the audience prompts
        </label>
        <label className="field">
          <span>How much</span>
          <select value={range} onChange={(e) => setRange(e.target.value as 'all' | 'shot')}>
            <option value="all">The whole film</option>
            <option value="shot">Just this shot</option>
          </select>
        </label>
      </section>

      <section className="group summary">
        <h3>What you’ll get</h3>
        <dl>
          <div><dt>Size</dt><dd>{preset.width} × {preset.height}</dd></div>
          <div><dt>Length</dt><dd>{(to - from).toFixed(1)}s · {frames} frames at {preset.fps}fps</dd></div>
          <div><dt>File</dt><dd>about {estimateMb.toFixed(0)} MB</dd></div>
        </dl>
        <p className="hint">{preset.note}</p>
      </section>

      {progress ? (
        <section className="group progress-group">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p>
            {progress.done} / {progress.total} frames · {progress.fps.toFixed(1)} fps ·
            {' '}about {Math.max(0, Math.round((progress.total - progress.done) / Math.max(0.1, progress.fps)))}s left
          </p>
          <button className="btn danger" onClick={() => abortRef.current?.abort()}>Stop</button>
        </section>
      ) : (
        <div className="row sticky-actions">
          <button className="btn primary big" disabled={!supported} onClick={run}>
            Export video
          </button>
        </div>
      )}

      <section className="group">
        <h3>Other files</h3>
        <div className="row wrap">
          <button
            className="btn"
            onClick={() => {
              const vtt = subtitlesToVTT(project);
              download(new Blob([vtt], { type: 'text/vtt' }), 'captions.vtt');
            }}
          >
            Subtitles (.vtt)
          </button>
          <button
            className="btn"
            onClick={async () => {
              const blob = await exportStill(project, time, 1920, 1080);
              download(blob, `thumbnail-${time.toFixed(1)}s.png`);
            }}
          >
            Thumbnail from this frame
          </button>
          <button
            className="btn"
            onClick={() => {
              const json = JSON.stringify(project, null, 1);
              const slug = project.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              download(new Blob([json], { type: 'application/json' }), `${slug}.bloom.json`);
            }}
          >
            Project file (.bloom.json)
          </button>
        </div>
        <p className="hint">
          The project file holds the whole film — scenes, animation, timings — and nothing else.
          Keep it: it is what you reopen to make changes.
        </p>
      </section>
    </div>
  );
}

function PresetRow({ preset, selected, onSelect }: { preset: ExportPreset; selected: boolean; onSelect: () => void }) {
  return (
    <button className={selected ? 'preset on' : 'preset'} onClick={onSelect}>
      <span className="preset-name">{preset.label}</span>
      <span className="preset-meta">{preset.width}×{preset.height} · {preset.fps}fps</span>
      <span className="preset-note">{preset.note}</span>
    </button>
  );
}
