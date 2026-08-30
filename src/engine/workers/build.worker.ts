/**
 * Script-building worker.
 *
 * Building a full film from a script bakes well over a hundred thousand
 * keyframes. On the main thread that is a visible freeze — the viewport stops,
 * the button stays depressed, and on a Chromebook it is long enough that people
 * click it twice.
 *
 * The parser and the auto-animator are pure functions over plain data, so they
 * move to a worker with no changes: text in, project JSON out.
 */

import { parseScript } from '../script/parser';
import { buildProjectFromScript, autoCast, type BuildOptions } from '../script/builder';

export interface BuildRequest {
  id: number;
  kind: 'build' | 'analyse';
  source: string;
  options?: BuildOptions;
}

export interface BuildResponse {
  id: number;
  ok: boolean;
  error?: string;
  /** Present for 'build'. */
  project?: unknown;
  warnings?: { line: number; message: string }[];
  cast?: { name: string; assetId: string; displayName: string }[];
  stats?: {
    scenes: number;
    shots: number;
    lines: number;
    beats: number;
    cues: number;
    keyframes: number;
    duration: number;
  };
  /** Milliseconds spent, so the UI can decide whether to bother showing a spinner. */
  ms?: number;
}

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const request = event.data;
  const started = performance.now();
  try {
    const parsed = parseScript(request.source);

    if (request.kind === 'analyse') {
      let lines = 0;
      let beats = 0;
      let cues = 0;
      for (const scene of parsed.scenes) {
        for (const beat of scene.beats) {
          if (beat.type === 'dialogue') lines++;
          else if (beat.type === 'interaction') beats++;
          else if (beat.type === 'sfx' || beat.type === 'music') cues++;
        }
      }
      const response: BuildResponse = {
        id: request.id,
        ok: true,
        warnings: parsed.warnings,
        cast: autoCast(parsed),
        stats: { scenes: parsed.scenes.length, shots: 0, lines, beats, cues, keyframes: 0, duration: 0 },
        ms: performance.now() - started,
      };
      (self as unknown as Worker).postMessage(response);
      return;
    }

    const project = buildProjectFromScript(parsed, request.options ?? {});
    project.scriptSource = request.source;

    const keyframes = project.scenes.reduce(
      (n, s) => n + s.nodes.reduce(
        (m, node) => m + (node.tracks ?? []).reduce((k, t) => k + t.keys.length, 0), 0), 0);

    const response: BuildResponse = {
      id: request.id,
      ok: true,
      project,
      warnings: parsed.warnings,
      cast: autoCast(parsed, request.options?.cast),
      stats: {
        scenes: project.scenes.length,
        shots: project.sequence.length,
        lines: project.audio.filter((a) => a.role === 'dialogue').length,
        beats: project.interactions.length,
        cues: project.audio.filter((a) => a.role !== 'dialogue').length,
        keyframes,
        duration: project.meta.duration,
      },
      ms: performance.now() - started,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: BuildResponse = {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: performance.now() - started,
    };
    (self as unknown as Worker).postMessage(response);
  }
};
