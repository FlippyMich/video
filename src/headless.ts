/**
 * Headless render entry point.
 *
 * Loaded by `render.html` and driven from Node (via Playwright) by the
 * production pipeline. It exposes the *same* `Player` the editor uses, so the
 * film that comes out of the pipeline is the film the editor previewed.
 *
 * Frames leave the browser as JPEG/PNG data URLs. That's a real cost, but it
 * keeps the pipeline to one dependency-free channel, and encoding dominates
 * transfer at every resolution we care about.
 */

import type { Project } from './engine/types';
import { Player } from './engine/render/player';
import { parseScript } from './engine/script/parser';
import { buildProjectFromScript, type BuildOptions } from './engine/script/builder';

export interface HeadlessInit {
  width: number;
  height: number;
  quality?: 'draft' | 'good' | 'best';
  subtitles?: boolean;
  overlays?: boolean;
  chromaKey?: boolean;
}

class Headless {
  private player: Player | null = null;
  private project: Project | null = null;

  loadProject(project: Project) {
    this.project = project;
    if (this.player) this.player.setProject(project);
    return { scenes: project.scenes.length, shots: project.sequence.length, duration: project.meta.duration };
  }

  buildFromScript(source: string, options: BuildOptions = {}) {
    const parsed = parseScript(source);
    const project = buildProjectFromScript(parsed, options);
    project.scriptSource = source;
    this.loadProject(project);
    return { project, warnings: parsed.warnings, cast: parsed.cast };
  }

  init(opts: HeadlessInit) {
    if (!this.project) throw new Error('Load a project before init()');
    this.player?.dispose();
    this.player = new Player(this.project, {
      width: opts.width,
      height: opts.height,
      quality: opts.quality ?? 'best',
      subtitles: opts.subtitles ?? false,
      overlays: opts.overlays ?? true,
      chromaKey: opts.chromaKey ?? false,
    });
    // Attaching the output canvas lets a human open render.html and watch.
    const host = document.getElementById('stage');
    if (host) {
      host.innerHTML = '';
      host.appendChild(this.player.output);
    }
    return { ok: true };
  }

  /**
   * Pre-build every scene so the first frame of each shot isn't slowed by
   * construction. Returns per-scene build times, which is how we spot a set
   * that has quietly become too heavy.
   */
  warmup(): { sceneId: string; ms: number }[] {
    if (!this.player || !this.project) throw new Error('init() first');
    return this.project.scenes.map((s) => {
      const t0 = performance.now();
      this.player!.getRuntime(s.id);
      return { sceneId: s.id, ms: Math.round(performance.now() - t0) };
    });
  }

  renderFrame(t: number, format: 'jpeg' | 'png' = 'jpeg', quality = 0.94): string {
    if (!this.player) throw new Error('init() first');
    this.player.render(t, 1 / (this.project?.meta.fps ?? 30));
    return this.player.output.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality);
  }

  /** Time one frame without paying the encode cost, for benchmarking. */
  benchmark(t: number, iterations = 3): { renderMs: number; encodeMs: number } {
    if (!this.player) throw new Error('init() first');
    const dt = 1 / (this.project?.meta.fps ?? 30);
    this.player.render(t, dt); // warm caches first
    const r0 = performance.now();
    for (let i = 0; i < iterations; i++) this.player.render(t + i * dt, dt);
    const renderMs = (performance.now() - r0) / iterations;
    const e0 = performance.now();
    this.player.output.toDataURL('image/jpeg', 0.94);
    const encodeMs = performance.now() - e0;
    return { renderMs, encodeMs };
  }

  getProject(): Project | null {
    return this.project;
  }
}

declare global {
  interface Window {
    bloom: Headless;
    bloomReady: boolean;
  }
}

window.bloom = new Headless();
window.bloomReady = true;
