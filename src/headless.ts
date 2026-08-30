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
import { bakeSceneToGLB, type BakeSceneOptions } from './engine/render/gltf-bake';

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

  /**
   * Every line that needs a voice recording, keyed the way `voiceTimings`
   * expects. The pipeline records these, then rebuilds the project with the
   * real durations so the cut follows the performance rather than an estimate.
   */
  listDialogue(source: string) {
    const parsed = parseScript(source);
    const out: { key: string; speaker: string; text: string; scene: string; sceneIndex: number; beatIndex: number }[] = [];
    parsed.scenes.forEach((scene, sceneIndex) => {
      scene.beats.forEach((beat, beatIndex) => {
        if (beat.type !== 'dialogue' || !beat.text) return;
        out.push({
          key: `${sceneIndex}:${beatIndex}`,
          speaker: beat.speaker ?? 'NARRATOR',
          text: beat.text,
          scene: scene.name,
          sceneIndex,
          beatIndex,
        });
      });
    });
    return { title: parsed.title, cast: parsed.cast, lines: out, warnings: parsed.warnings };
  }

  /** Sound and music cues, so the pipeline knows which files to synthesise. */
  listCues(source: string) {
    const parsed = parseScript(source);
    const sfx = new Set<string>();
    const music = new Set<string>();
    for (const scene of parsed.scenes) {
      for (const beat of scene.beats) {
        if (beat.type === 'sfx' && beat.sound) sfx.add(beat.sound);
        if (beat.type === 'music' && beat.sound) music.add(beat.sound);
      }
    }
    return { sfx: [...sfx], music: [...music] };
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

  /**
   * Draw a frame onto the output canvas and stop there.
   *
   * The production renderer wants the pixels as a Blob, not as a data URL —
   * `toDataURL` costs ~490ms per 1080p frame against ~23ms for `toBlob`, which
   * is the difference between a two-hour render and a ten-minute one. So the
   * drawing and the encoding are separate calls, and the renderer only pays for
   * the encoding it actually uses.
   */
  drawFrame(t: number): void {
    if (!this.player) throw new Error('init() first');
    this.player.render(t, 1 / (this.project?.meta.fps ?? 30));
  }

  /** Draw and encode in one go. Convenient for stills; too slow for a film. */
  renderFrame(t: number, format: 'jpeg' | 'png' = 'jpeg', quality = 0.94): string {
    this.drawFrame(t);
    return this.player!.output.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality);
  }

  /** The canvas the renderer should capture. */
  get canvas(): HTMLCanvasElement | null {
    return this.player?.output ?? null;
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

  /**
   * Bake one scene to a .glb, animation and camera included.
   *
   * Returned as a base64 string: it's the only shape that survives the
   * automation bridge intact, and a scene is a few megabytes, not a few
   * hundred.
   */
  async exportSceneGLB(sceneId: string, options: BakeSceneOptions = {}) {
    if (!this.project) throw new Error('Load a project first');
    const scene = this.project.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`No scene "${sceneId}"`);
    const baked = await bakeSceneToGLB(this.project, scene, options);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < baked.data.length; i += chunk) {
      binary += String.fromCharCode(...baked.data.subarray(i, i + chunk));
    }
    return {
      sceneId: baked.sceneId,
      name: baked.name,
      start: baked.start,
      duration: baked.duration,
      frames: baked.frames,
      keyCount: baked.keyCount,
      bytes: baked.data.length,
      base64: btoa(binary),
    };
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
