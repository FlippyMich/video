/**
 * Particle effects.
 *
 * One `THREE.Points` cloud per emitter, simulated on the CPU into a shared
 * Float32Array. That sounds slow until you notice the budget: a few thousand
 * particles at 30fps is a rounding error next to the toon meshes, and doing it
 * on the CPU means the simulation is *deterministic* — the same frame renders
 * identically in the editor preview and in the final export.
 *
 * Every emitter is seeded, so scrubbing backwards works: `update()` reseeds and
 * fast-forwards when time jumps backwards.
 */

import * as THREE from 'three';
import { PALETTE } from '../assets/palette';

export type FxKind =
  | 'fx.sparkles'
  | 'fx.petals'
  | 'fx.pollen'
  | 'fx.bubbles'
  | 'fx.hearts'
  | 'fx.notes'
  | 'fx.confetti'
  | 'fx.snow'
  | 'fx.dust'
  | 'fx.stars'
  | 'fx.rain';

export interface FxParams {
  count?: number;
  color?: number;
  color2?: number;
  size?: number;
  /** Emission volume, in world units. */
  spread?: number;
  height?: number;
  /** Upward drift; negative falls. */
  rise?: number;
  gravity?: number;
  turbulence?: number;
  lifetime?: number;
  /** Emit continuously, or one burst at the node's start. */
  burst?: boolean;
  opacity?: number;
}

interface EmitterDefaults extends Required<Omit<FxParams, 'color2'>> {
  color2: number;
}

const DEFAULTS: Record<FxKind, EmitterDefaults> = {
  'fx.sparkles': { count: 90, color: PALETTE.butter, color2: PALETTE.white, size: 0.14, spread: 2.2, height: 2.2, rise: 0.35, gravity: 0, turbulence: 0.7, lifetime: 1.6, burst: false, opacity: 1 },
  'fx.petals':   { count: 70, color: PALETTE.petalBlush, color2: PALETTE.petalPink, size: 0.17, spread: 7, height: 6, rise: -0.55, gravity: 0.06, turbulence: 1.1, lifetime: 8, burst: false, opacity: 1 },
  'fx.pollen':   { count: 120, color: PALETTE.butter, color2: PALETTE.honey, size: 0.07, spread: 5, height: 3, rise: 0.12, gravity: 0, turbulence: 0.5, lifetime: 6, burst: false, opacity: 0.85 },
  'fx.bubbles':  { count: 50, color: 0xd8f4ff, color2: PALETTE.white, size: 0.2, spread: 1.6, height: 3.5, rise: 0.9, gravity: 0, turbulence: 0.4, lifetime: 4, burst: false, opacity: 0.7 },
  'fx.hearts':   { count: 26, color: PALETTE.petalRose, color2: PALETTE.petalPink, size: 0.28, spread: 1.1, height: 2.4, rise: 1.1, gravity: 0, turbulence: 0.5, lifetime: 2.2, burst: true, opacity: 1 },
  'fx.notes':    { count: 22, color: PALETTE.petalPurple, color2: PALETTE.skyDeep, size: 0.3, spread: 1.6, height: 2.8, rise: 1.0, gravity: 0, turbulence: 0.8, lifetime: 2.6, burst: false, opacity: 1 },
  'fx.confetti': { count: 180, color: PALETTE.strawberry, color2: PALETTE.lemon, size: 0.15, spread: 5, height: 5, rise: -1.2, gravity: 0.4, turbulence: 1.6, lifetime: 4, burst: true, opacity: 1 },
  'fx.snow':     { count: 200, color: PALETTE.white, color2: PALETTE.cloudShade, size: 0.11, spread: 9, height: 7, rise: -0.4, gravity: 0.02, turbulence: 0.6, lifetime: 12, burst: false, opacity: 0.95 },
  'fx.dust':     { count: 60, color: PALETTE.sand, color2: PALETTE.butter, size: 0.09, spread: 3, height: 1.4, rise: 0.1, gravity: 0, turbulence: 0.35, lifetime: 5, burst: false, opacity: 0.55 },
  'fx.stars':    { count: 60, color: PALETTE.lemon, color2: PALETTE.white, size: 0.2, spread: 3, height: 3, rise: 0.5, gravity: 0, turbulence: 0.9, lifetime: 1.8, burst: true, opacity: 1 },
  'fx.rain':     { count: 300, color: 0xa8d8f0, color2: 0xd0ecff, size: 0.06, spread: 8, height: 8, rise: -6, gravity: 1.5, turbulence: 0.1, lifetime: 1.6, burst: false, opacity: 0.7 },
};

/**
 * Simulated objects. They live in the same list as the particle effects because
 * to a user they are the same thing — something that moves on its own — even
 * though they are solved rather than emitted.
 */
export const SIM_LIST: { id: string; name: string; description: string }[] = [
  { id: 'sim.cloth', name: 'Cloth', description: 'A simulated sheet — a flag, a cape, a blanket. Blows in the wind.' },
  { id: 'sim.rope', name: 'Rope', description: 'A hanging chain that swings. For swings, strings and chimes.' },
  { id: 'sim.ball', name: 'Bouncing ball', description: 'Drops, bounces and squashes on impact.' },
];

export const FX_LIST: { id: FxKind; name: string; description: string }[] = [
  { id: 'fx.sparkles', name: 'Sparkles', description: 'Twinkles around a character. The "magic happened" cue.' },
  { id: 'fx.petals', name: 'Falling petals', description: 'Drifts down across the whole frame. Lovely under titles.' },
  { id: 'fx.pollen', name: 'Pollen motes', description: 'Tiny golden specks hanging in sunlight.' },
  { id: 'fx.bubbles', name: 'Bubbles', description: 'Rise and wobble. For pond and bath scenes.' },
  { id: 'fx.hearts', name: 'Hearts', description: 'A burst of hearts. Pairs with the "I love it" beat.' },
  { id: 'fx.notes', name: 'Music notes', description: 'Float up during songs and sing-alongs.' },
  { id: 'fx.confetti', name: 'Confetti', description: 'Celebration burst. Use at the end of a challenge.' },
  { id: 'fx.snow', name: 'Snow', description: 'Slow, wide, wintery.' },
  { id: 'fx.dust', name: 'Dust motes', description: 'Subtle atmosphere for indoor sets.' },
  { id: 'fx.stars', name: 'Star burst', description: 'Cartoon stars popping outward.' },
  { id: 'fx.rain', name: 'Rain', description: 'Fast falling streaks.' },
];

/** Round soft dot, drawn once and shared by every emitter. */
let dotTexture: THREE.CanvasTexture | null = null;
function getDot(): THREE.CanvasTexture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

interface Emitter {
  id: string;
  kind: FxKind;
  params: EmitterDefaults;
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  /** Per-particle: seed, birth offset, speed multiplier, sway phase. */
  seeds: Float32Array;
  parent: THREE.Object3D;
  material: THREE.PointsMaterial;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class FxSystem {
  readonly root = new THREE.Group();
  private emitters: Emitter[] = [];

  constructor() {
    this.root.name = 'fx';
  }

  add(id: string, kind: string, parent: THREE.Object3D, params: FxParams = {}) {
    const k = (kind in DEFAULTS ? kind : 'fx.sparkles') as FxKind;
    const p: EmitterDefaults = { ...DEFAULTS[k], ...params } as EmitterDefaults;
    const n = Math.max(1, Math.round(p.count));

    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const seeds = new Float32Array(n * 4);
    const cA = new THREE.Color(p.color);
    const cB = new THREE.Color(p.color2 ?? p.color);

    for (let i = 0; i < n; i++) {
      seeds[i * 4 + 0] = hash(i * 1.13 + 0.5);
      seeds[i * 4 + 1] = hash(i * 2.71 + 1.5);
      seeds[i * 4 + 2] = 0.6 + hash(i * 3.37 + 2.5) * 0.9;
      seeds[i * 4 + 3] = hash(i * 5.19 + 3.5) * Math.PI * 2;
      const mix = hash(i * 7.77);
      const c = cA.clone().lerp(cB, mix);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: p.size,
      map: getDot(),
      vertexColors: true,
      transparent: true,
      opacity: p.opacity,
      depthWrite: false,
      blending: k === 'fx.sparkles' || k === 'fx.stars' ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    parent.add(points);

    this.emitters.push({ id, kind: k, params: p, points, positions, colors, seeds, parent, material });
  }

  remove(id: string) {
    const i = this.emitters.findIndex((e) => e.id === id);
    if (i < 0) return;
    const e = this.emitters[i];
    e.points.removeFromParent();
    e.points.geometry.dispose();
    e.material.dispose();
    this.emitters.splice(i, 1);
  }

  /**
   * Position is a pure function of absolute time, so there is no accumulated
   * state to get out of sync when the user scrubs.
   */
  update(t: number, _dt: number) {
    for (const e of this.emitters) {
      const { params: p, positions, seeds } = e;
      const n = positions.length / 3;
      for (let i = 0; i < n; i++) {
        const sx = seeds[i * 4 + 0];
        const sz = seeds[i * 4 + 1];
        const speed = seeds[i * 4 + 2];
        const phase = seeds[i * 4 + 3];

        // Each particle has its own birth offset so they don't pulse together.
        const life = p.lifetime;
        const born = sx * life;
        const age = p.burst ? Math.min(life, Math.max(0, t)) : ((t * speed + born) % life);
        const u = age / life;

        const rise = p.rise * age;
        const fall = -0.5 * p.gravity * age * age;
        const swayX = Math.sin(phase + age * 1.7 * speed) * p.turbulence * 0.4;
        const swayZ = Math.cos(phase * 1.3 + age * 1.3 * speed) * p.turbulence * 0.4;

        positions[i * 3 + 0] = (sx - 0.5) * p.spread + swayX;
        positions[i * 3 + 1] = (p.rise < 0 ? p.height * (1 - u) : (sz - 0.5) * 0.5) + rise + fall;
        positions[i * 3 + 2] = (sz - 0.5) * p.spread + swayZ;
      }
      e.points.geometry.attributes.position.needsUpdate = true;

      // Bursts fade out; continuous emitters just loop.
      if (p.burst) {
        const u = Math.min(1, Math.max(0, t) / p.lifetime);
        e.material.opacity = p.opacity * Math.max(0, 1 - u * u);
      }
    }
  }

  dispose() {
    for (const e of [...this.emitters]) this.remove(e.id);
    this.root.clear();
  }
}
