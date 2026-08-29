/**
 * Keyframe evaluation.
 *
 * Tracks are sampled thousands of times per second during scrubbing, so the hot
 * path here is a binary search plus one easing call — no allocation, no map
 * lookups per key.
 */

import type { AnimTrack, Easing, Keyframe } from '../types';

export function ease(t: number, kind: Easing = 'linear'): number {
  switch (kind) {
    case 'step':
      return 0;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'bounce': {
      // Overshoot then settle — the "cartoon snap".
      const c = 1.70158 * 1.525;
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
    }
    case 'elastic': {
      if (t === 0 || t === 1) return t;
      const p = 0.35;
      return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
    }
    case 'linear':
    default:
      return t;
  }
}

/** Sample a sorted key list at time `t`. Clamps outside the range. */
export function sampleKeys(keys: Keyframe[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1 || t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b.t - a.t;
  if (span <= 1e-9) return b.v;
  const u = ease((t - a.t) / span, a.ease ?? 'easeInOut');
  return a.v + (b.v - a.v) * u;
}

export function sampleTrack(track: AnimTrack, t: number): number {
  if (track.muted) return 0;
  return sampleKeys(track.keys, t);
}

/** Insert or replace a key, keeping the list sorted. Returns the same array. */
export function setKey(keys: Keyframe[], t: number, v: number, ease?: Easing): Keyframe[] {
  const epsilon = 1e-4;
  const i = keys.findIndex((k) => Math.abs(k.t - t) < epsilon);
  if (i >= 0) {
    keys[i].v = v;
    if (ease) keys[i].ease = ease;
    return keys;
  }
  const at = keys.findIndex((k) => k.t > t);
  const key: Keyframe = ease ? { t, v, ease } : { t, v };
  if (at < 0) keys.push(key);
  else keys.splice(at, 0, key);
  return keys;
}

export function removeKey(keys: Keyframe[], t: number): Keyframe[] {
  const epsilon = 1e-4;
  const i = keys.findIndex((k) => Math.abs(k.t - t) < epsilon);
  if (i >= 0) keys.splice(i, 1);
  return keys;
}

export function trackRange(track: AnimTrack): [number, number] {
  if (!track.keys.length) return [0, 0];
  return [track.keys[0].t, track.keys[track.keys.length - 1].t];
}

/** Snap a time to the nearest frame boundary. */
export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

/**
 * Drop keys that sit on the straight line between their neighbours.
 * Baked tracks (lip-sync, imported motion) routinely shrink by 60–80%, which is
 * the difference between a snappy timeline and a stuttering one.
 */
export function simplifyKeys(keys: Keyframe[], tolerance = 0.004): Keyframe[] {
  if (keys.length < 3) return keys;
  const out: Keyframe[] = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const prev = out[out.length - 1];
    const next = keys[i + 1];
    const span = next.t - prev.t;
    const expected = span <= 1e-9 ? prev.v : prev.v + ((next.v - prev.v) * (keys[i].t - prev.t)) / span;
    if (Math.abs(keys[i].v - expected) > tolerance) out.push(keys[i]);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** Shift every key in a track by `dt` seconds. */
export function shiftKeys(keys: Keyframe[], dt: number): Keyframe[] {
  return keys.map((k) => ({ ...k, t: k.t + dt }));
}

/** Scale a track's timing about `pivot` — used when a shot is retimed. */
export function scaleKeys(keys: Keyframe[], factor: number, pivot = 0): Keyframe[] {
  return keys.map((k) => ({ ...k, t: pivot + (k.t - pivot) * factor }));
}

/**
 * Small deterministic value noise. Drives handheld camera and idle sway, where a
 * true random would jitter differently on every render pass and break
 * frame-by-frame reproducibility.
 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.31) * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** Layered noise — more natural than a single octave for camera drift. */
export function fbm1(x: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq, seed + i) * amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum;
}
