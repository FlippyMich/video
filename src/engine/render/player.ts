/**
 * The player.
 *
 * One class renders a frame of the project at time `t` — used by the editor
 * viewport, by the in-browser exporter and by the headless production renderer.
 * Having exactly one code path is the whole point: the preview cannot drift
 * from the export, because they are the same function.
 *
 * The 3D pass goes to a WebGL canvas; everything on top of it (transitions,
 * colour effects, subtitles, the interaction overlays) is composited onto a 2D
 * canvas. Canvas2D compositing is GPU-accelerated in every browser we target,
 * so the 2D layer costs far less than a post-processing chain would, and it can
 * do things — crisp text at any resolution — that a shader would struggle with.
 */

import * as THREE from 'three';
import type { InteractionBeat, Project, Shot, SubtitleCue } from '../types';
import { SceneRuntime } from '../scene-builder';
import { composeShot, shotAt, transitionProgress, type CameraState } from './director';
import { fbm1 } from '../anim/keyframes';

export interface PlayerOptions {
  width: number;
  height: number;
  /** Devices with no GPU headroom can drop shadows and antialiasing. */
  quality?: 'draft' | 'good' | 'best';
  /** Render captions into the frame. Off for the master, on for a burned-in cut. */
  subtitles?: boolean;
  /** Draw the audience-participation overlays. */
  overlays?: boolean;
  /** Force every scene into flat-green chroma mode. */
  chromaKey?: boolean;
  canvas?: HTMLCanvasElement;
}

const QUALITY = {
  draft: { shadows: false, antialias: false, pixelRatio: 0.75 },
  good: { shadows: true, antialias: true, pixelRatio: 1 },
  best: { shadows: true, antialias: true, pixelRatio: 1 },
};

export class Player {
  readonly renderer: THREE.WebGLRenderer;
  /** The canvas callers should display or capture. */
  readonly output: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scenes = new Map<string, SceneRuntime>();
  private project: Project;
  private opts: Required<Omit<PlayerOptions, 'canvas'>>;
  private camState: CameraState = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 38 };
  private renderCamera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  /** Offscreen copy used only while a crossfade is in flight. */
  private fadeCanvas: HTMLCanvasElement | null = null;
  private _currentTime = 0;

  constructor(project: Project, options: PlayerOptions) {
    this.project = project;
    this.opts = {
      width: options.width,
      height: options.height,
      quality: options.quality ?? 'good',
      subtitles: options.subtitles ?? false,
      overlays: options.overlays ?? true,
      chromaKey: options.chromaKey ?? false,
    };
    const q = QUALITY[this.opts.quality];

    const glCanvas = options.canvas ?? document.createElement('canvas');
    glCanvas.width = Math.round(this.opts.width * q.pixelRatio);
    glCanvas.height = Math.round(this.opts.height * q.pixelRatio);

    this.renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      antialias: q.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(glCanvas.width, glCanvas.height, false);
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.output = document.createElement('canvas');
    this.output.width = this.opts.width;
    this.output.height = this.opts.height;
    // `willReadFrequently` keeps the composite canvas in CPU memory. Every
    // frame of an export is read back, so a GPU-resident canvas would stall on
    // readback far longer than the software compositing costs.
    this.ctx = this.output.getContext('2d', { alpha: false, willReadFrequently: true })!;

    this.renderCamera.aspect = this.opts.width / this.opts.height;
    this.renderCamera.updateProjectionMatrix();
  }

  /** Time of the most recently rendered frame. */
  get currentTime() { return this._currentTime; }
  get width() { return this.opts.width; }
  get height() { return this.opts.height; }

  setProject(project: Project) {
    this.project = project;
    for (const rt of this.scenes.values()) rt.dispose();
    this.scenes.clear();
  }

  /** Force a scene to rebuild — called when the user edits its contents. */
  invalidateScene(sceneId: string) {
    const rt = this.scenes.get(sceneId);
    if (rt) { rt.dispose(); this.scenes.delete(sceneId); }
  }

  getRuntime(sceneId: string): SceneRuntime | null {
    const hit = this.scenes.get(sceneId);
    if (hit) return hit;
    const doc = this.project.scenes.find((s) => s.id === sceneId);
    if (!doc) return null;
    const spec = this.opts.chromaKey ? { ...doc, environment: { ...doc.environment, chromaKey: true } } : doc;
    const rt = new SceneRuntime(spec, {
      shadows: QUALITY[this.opts.quality].shadows && !this.opts.chromaKey,
      aspect: this.opts.width / this.opts.height,
    });
    this.scenes.set(sceneId, rt);
    return rt;
  }

  /**
   * Render one frame. `dt` only drives effects that need a real delta; the
   * animation itself is a pure function of `t`, so seeking is exact.
   */
  render(t: number, dt = 1 / 30) {
    const { sequence } = this.project;
    const hit = shotAt(sequence, t);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (!hit) {
      ctx.fillStyle = '#12101a';
      ctx.fillRect(0, 0, this.output.width, this.output.height);
      ctx.restore();
      return;
    }

    const fade = transitionProgress(hit.shot, t);
    const prev = fade > 0 && hit.index > 0 ? sequence[hit.index - 1] : null;

    // Outgoing frame first, so the incoming one can be drawn over it.
    if (prev && fade > 0) {
      this.renderShotTo3D(prev, t, dt);
      this.blitToFade();
    }

    this.renderShotTo3D(hit.shot, t, dt);
    this.compositeFrame(hit.shot, t, fade, prev);
    if (this.opts.overlays) this.drawInteractions(t);
    if (this.opts.subtitles) this.drawSubtitles(t);
    ctx.restore();
    this._currentTime = t;
  }

  /* ---------------------------------------------------------------- *
   * 3D pass
   * ---------------------------------------------------------------- */

  private renderShotTo3D(shot: Shot, t: number, dt: number) {
    const rt = this.getRuntime(shot.sceneId);
    if (!rt) return;

    rt.update(t, dt);

    const u = shot.duration > 0 ? THREE.MathUtils.clamp((t - shot.start) / shot.duration, 0, 1) : 0;
    composeShot(rt, shot, u, this.opts.width / this.opts.height, this.camState);

    this.renderCamera.position.copy(this.camState.position);
    this.renderCamera.lookAt(this.camState.target);
    this.renderCamera.fov = this.camState.fov;
    this.renderCamera.aspect = this.opts.width / this.opts.height;
    this.renderCamera.updateProjectionMatrix();

    // Characters look down the lens during audience beats — the direct address
    // that makes a preschool show feel like a conversation.
    const beat = this.activeInteraction(t);
    rt.setEyeTarget(beat ? this.camState.position : null);
    rt.focusShadowsOn(this.camState.target);

    this.renderer.render(rt.scene, this.renderCamera);
  }

  private blitToFade() {
    if (!this.fadeCanvas) {
      this.fadeCanvas = document.createElement('canvas');
      this.fadeCanvas.width = this.output.width;
      this.fadeCanvas.height = this.output.height;
    }
    const c = this.fadeCanvas.getContext('2d')!;
    c.drawImage(this.renderer.domElement, 0, 0, this.fadeCanvas.width, this.fadeCanvas.height);
  }

  /* ---------------------------------------------------------------- *
   * 2D composite
   * ---------------------------------------------------------------- */

  private compositeFrame(shot: Shot, t: number, fade: number, prev: Shot | null) {
    const ctx = this.ctx;
    const W = this.output.width;
    const H = this.output.height;
    const gl = this.renderer.domElement;

    const fx = shot.effects ?? [];
    const amountOf = (type: string) => {
      const e = fx.find((f) => f.type === type);
      if (!e) return 0;
      if (e.start === undefined) return e.amount;
      const local = t - shot.start;
      if (local < e.start || local > e.start + (e.duration ?? shot.duration)) return 0;
      return e.amount;
    };

    // --- colour grade, applied while blitting so it costs nothing extra ---
    const sat = 1 + amountOf('saturate') * 0.5 - amountOf('desaturate') * 0.8;
    const filters: string[] = [];
    if (Math.abs(sat - 1) > 0.01) filters.push(`saturate(${sat.toFixed(3)})`);
    const bloom = amountOf('bloom-boost');
    if (bloom > 0) filters.push(`brightness(${(1 + bloom * 0.12).toFixed(3)})`);
    ctx.filter = filters.length ? filters.join(' ') : 'none';

    // --- camera-space effects: shake and zoom punch ---
    const shake = amountOf('shake');
    const punch = amountOf('zoom-punch');
    let scale = 1;
    let dx = 0;
    let dy = 0;
    if (shake > 0) {
      dx = fbm1(t * 26, 3) * shake * W * 0.012;
      dy = fbm1(t * 26 + 50, 7) * shake * H * 0.012;
      scale = Math.max(scale, 1 + shake * 0.02);
    }
    if (punch > 0) {
      const local = t - shot.start;
      // A punch is a fast in, slow out — a symmetric curve reads as a mistake.
      const p = Math.max(0, 1 - local / 0.45);
      scale = Math.max(scale, 1 + punch * 0.12 * p * p);
    }

    ctx.save();
    if (scale !== 1 || dx || dy) {
      ctx.translate(W / 2 + dx, H / 2 + dy);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.drawImage(gl, 0, 0, W, H);
    ctx.restore();
    ctx.filter = 'none';

    // --- transition ---
    if (fade > 0 && prev && this.fadeCanvas) {
      const type = shot.transitionIn!.type;
      ctx.save();
      if (type === 'crossfade') {
        ctx.globalAlpha = fade;
        ctx.drawImage(this.fadeCanvas, 0, 0);
      } else if (type === 'fade-to-black' || type === 'fade-to-white') {
        // Out to the colour for the first half, in from it for the second.
        const half = fade > 0.5 ? (fade - 0.5) * 2 : (0.5 - fade) * 2;
        if (fade > 0.5) ctx.drawImage(this.fadeCanvas, 0, 0);
        ctx.globalAlpha = 1 - half;
        ctx.fillStyle = type === 'fade-to-black' ? '#000' : '#fff';
        ctx.fillRect(0, 0, W, H);
      } else if (type === 'wipe-left') {
        const x = W * (1 - fade);
        ctx.drawImage(this.fadeCanvas, 0, 0, W, H, -W + x, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(x - 6, 0, 6, H);
      } else if (type === 'iris') {
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.beginPath();
        const r = Math.hypot(W, H) * 0.5 * fade;
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(this.fadeCanvas, 0, 0);
        ctx.restore();
      } else if (type === 'whip-pan') {
        const shift = W * fade;
        ctx.filter = `blur(${(fade * 14).toFixed(1)}px)`;
        ctx.drawImage(this.fadeCanvas, 0, 0, W, H, -shift, 0, W, H);
        ctx.filter = 'none';
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // --- warmth / coolness ---
    const warm = amountOf('warm');
    const cool = amountOf('cool');
    if (warm > 0 || cool > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.max(warm, cool) * 0.35;
      ctx.fillStyle = warm > cool ? '#ffb35c' : '#7fb8ff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // --- vignette ---
    const vig = amountOf('vignette');
    if (vig > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.58);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${(vig * 0.55).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // --- sparkle overlay ---
    const sparkle = amountOf('sparkle-overlay');
    if (sparkle > 0) this.drawSparkleOverlay(t, sparkle);
  }

  private drawSparkleOverlay(t: number, strength: number) {
    const ctx = this.ctx;
    const W = this.output.width;
    const H = this.output.height;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      const seed = i * 3.77;
      const life = 1.4;
      const age = ((t + seed) % life) / life;
      const x = (Math.sin(seed * 12.9898) * 0.5 + 0.5) * W;
      const y = ((Math.sin(seed * 78.233) * 0.5 + 0.5) - age * 0.25) * H;
      const r = (6 + 14 * (1 - age)) * strength;
      const a = Math.sin(age * Math.PI) * strength * 0.85;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff4c2';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Four-point flare — a plain dot reads as dirt on the lens.
      ctx.fillRect(x - r * 2.6, y - r * 0.12, r * 5.2, r * 0.24);
      ctx.fillRect(x - r * 0.12, y - r * 2.6, r * 0.24, r * 5.2);
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- *
   * Overlays
   * ---------------------------------------------------------------- */

  private activeInteraction(t: number): InteractionBeat | null {
    for (const b of this.project.interactions) {
      if (t >= b.start && t < b.start + b.duration) return b;
    }
    return null;
  }

  private drawInteractions(t: number) {
    const beat = this.activeInteraction(t);
    if (!beat) return;
    const ctx = this.ctx;
    const W = this.output.width;
    const H = this.output.height;
    const local = t - beat.start;
    const u = local / beat.duration;
    // Ease the whole overlay in and out so it never pops.
    const alpha = Math.min(1, local / 0.35) * Math.min(1, (beat.duration - local) / 0.4);
    if (alpha <= 0) return;

    const S = H / 1080; // one scale factor keeps every size resolution-independent

    ctx.save();
    ctx.globalAlpha = alpha;

    /* prompt banner */
    if (beat.prompt) {
      const fontSize = 52 * S;
      ctx.font = `800 ${fontSize}px "Baloo 2", "Nunito", system-ui, sans-serif`;
      const metrics = ctx.measureText(beat.prompt);
      const padX = 46 * S;
      const padY = 26 * S;
      const boxW = Math.min(W - 120 * S, metrics.width + padX * 2);
      const boxH = fontSize + padY * 2;
      const x = (W - boxW) / 2;
      const y = H - boxH - 150 * S;

      roundRect(ctx, x + 6 * S, y + 8 * S, boxW, boxH, 34 * S);
      ctx.fillStyle = 'rgba(58,51,64,0.35)';
      ctx.fill();
      roundRect(ctx, x, y, boxW, boxH, 34 * S);
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.lineWidth = 6 * S;
      ctx.strokeStyle = '#39304a';
      ctx.stroke();

      ctx.fillStyle = '#3a3340';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(beat.prompt, W / 2, y + boxH / 2, boxW - padX * 2);
    }

    /* overlay graphics */
    switch (beat.overlay) {
      case 'countdown': {
        const remaining = Math.ceil(beat.duration - local);
        const size = 190 * S;
        const cx = W - size * 0.9;
        const cy = size * 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,253,246,0.94)';
        ctx.fill();
        ctx.lineWidth = 12 * S;
        ctx.strokeStyle = '#ffc23d';
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - u));
        ctx.stroke();
        ctx.fillStyle = '#3a3340';
        ctx.font = `800 ${96 * S}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.max(1, remaining)), cx, cy + 4 * S);
        break;
      }
      case 'bouncing-ball': {
        // Rides above the prompt, bouncing on the beat — the sing-along cue.
        const bpm = 120;
        const beatT = (t * bpm) / 60;
        const bounce = Math.abs(Math.sin(beatT * Math.PI));
        const x = W / 2 + Math.sin(beatT * Math.PI * 0.5) * W * 0.18;
        const y = H - 300 * S - bounce * 90 * S;
        ctx.beginPath();
        ctx.arc(x, y, 34 * S, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8fb1';
        ctx.fill();
        ctx.lineWidth = 6 * S;
        ctx.strokeStyle = '#39304a';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - 11 * S, y - 11 * S, 10 * S, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
        break;
      }
      case 'hand-icon': {
        const wobble = Math.sin(t * 7) * 0.22;
        const x = W - 210 * S;
        const y = H / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(wobble);
        ctx.font = `${170 * S}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👋', 0, 0);
        ctx.restore();
        break;
      }
      case 'answer-pop': {
        // The answer arrives only in the last third — after the children have
        // had a real chance to say it themselves.
        if (u > 0.62 && beat.answer) {
          const pop = Math.min(1, (u - 0.62) / 0.12);
          const s = 0.7 + 0.3 * easeOutBack(pop);
          ctx.save();
          ctx.translate(W / 2, H * 0.28);
          ctx.scale(s, s);
          ctx.font = `800 ${88 * S}px "Baloo 2", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 16 * S;
          ctx.strokeStyle = '#39304a';
          ctx.lineJoin = 'round';
          ctx.strokeText(beat.answer, 0, 0);
          ctx.fillStyle = '#ffe38a';
          ctx.fillText(beat.answer, 0, 0);
          ctx.restore();
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  private drawSubtitles(t: number) {
    const cue = this.project.subtitles.find((c) => t >= c.start && t < c.end);
    if (!cue) return;
    drawCaption(this.ctx, cue, this.output.width, this.output.height);
  }

  dispose() {
    for (const rt of this.scenes.values()) rt.dispose();
    this.scenes.clear();
    this.renderer.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Shared drawing helpers
 * ------------------------------------------------------------------ */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function easeOutBack(t: number): number {
  const c = 1.70158 + 1;
  return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
}

/** Broadcast-style caption: heavy outline, safe-area aware, two lines maximum. */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  cue: SubtitleCue,
  W: number,
  H: number,
) {
  const S = H / 1080;
  const lines = cue.text.split('\n').slice(0, 2);
  const fontSize = 54 * S;
  const lineHeight = fontSize * 1.22;
  // 5% title-safe margin from the bottom, which is where YouTube's own UI stops.
  const bottom = H - H * 0.075;
  ctx.save();
  ctx.font = `700 ${fontSize}px "Nunito", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 11 * S;
  ctx.strokeStyle = 'rgba(20,16,26,0.92)';

  lines.forEach((line, i) => {
    const y = bottom - (lines.length - 1 - i) * lineHeight;
    ctx.strokeText(line, W / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, W / 2, y);
  });
  ctx.restore();
}
