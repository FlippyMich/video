/**
 * Client for the script-building worker.
 *
 * One worker, kept alive between builds — spawning one per click costs more in
 * startup than most builds cost to run. Requests are matched by id, and a new
 * request supersedes any in flight, because the only thing anyone wants after
 * typing another character is the newest result.
 *
 * Falls back to running on the main thread where workers aren't available. The
 * fallback isn't hypothetical: it's what makes the same code usable from Node in
 * the production pipeline.
 */

import type { Project } from '../types';
import type { BuildOptions } from '../script/builder';
import type { BuildResponse } from './build.worker';

type Pending = {
  resolve: (r: BuildResponse) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<BuildResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data);
      else entry.reject(new Error(event.data.error ?? 'The script could not be built.'));
    };
    worker.onerror = (e) => {
      // A worker that has died takes every outstanding request with it.
      for (const entry of pending.values()) entry.reject(new Error(e.message || 'Worker failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export interface BuildResult {
  project: Project;
  warnings: { line: number; message: string }[];
  cast: { name: string; assetId: string; displayName: string }[];
  stats: NonNullable<BuildResponse['stats']>;
  ms: number;
  /** True when the worker wasn't available and this ran on the main thread. */
  onMainThread: boolean;
}

export async function buildInWorker(source: string, options: BuildOptions = {}): Promise<BuildResult> {
  const w = getWorker();
  if (!w) return buildOnMainThread(source, options);

  const id = nextId++;
  const response = await new Promise<BuildResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, kind: 'build', source, options });
  });

  return {
    project: response.project as Project,
    warnings: response.warnings ?? [],
    cast: response.cast ?? [],
    stats: response.stats!,
    ms: response.ms ?? 0,
    onMainThread: false,
  };
}

async function buildOnMainThread(source: string, options: BuildOptions): Promise<BuildResult> {
  const started = performance.now();
  const { parseScript } = await import('../script/parser');
  const { buildProjectFromScript, autoCast } = await import('../script/builder');
  const parsed = parseScript(source);
  const project = buildProjectFromScript(parsed, options);
  project.scriptSource = source;
  const keyframes = project.scenes.reduce(
    (n, s) => n + s.nodes.reduce(
      (m, node) => m + (node.tracks ?? []).reduce((k, t) => k + t.keys.length, 0), 0), 0);
  return {
    project,
    warnings: parsed.warnings,
    cast: autoCast(parsed, options.cast),
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
    onMainThread: true,
  };
}

/** Free the worker. Called when the editor tears down. */
export function disposeBuildWorker() {
  worker?.terminate();
  worker = null;
  pending.clear();
}
