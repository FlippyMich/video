/**
 * The virtual director.
 *
 * A shot can name a camera node, but it usually doesn't. Instead it says
 * "medium shot on Buzzy, push in" and this module works out where the camera
 * goes. That's the whole point: a teacher shouldn't have to place a camera in
 * 3D space to get a decent close-up.
 *
 * Framing distances come from the classic shot sizes, computed from the
 * subject's height and the lens FOV rather than hardcoded, so the same preset
 * works on a bee and on a tree.
 */

import * as THREE from 'three';
import type { CameraMove, FramingPreset, Shot } from '../types';
import { fbm1 } from '../anim/keyframes';
import type { SceneRuntime } from '../scene-builder';

export interface FramingSpec {
  /** Fraction of the subject's height that should fill the frame. */
  coverage: number;
  /** Eye-height offset as a fraction of subject height. */
  aim: number;
  /**
   * Aim at the character's actual head rather than at a fraction of its
   * height. Tight shots must do this: "92% of the way up" lands well below the
   * face on a character whose head is a third of its body, and crops it.
   */
  aimHead?: boolean;
  /**
   * Coverage expressed in head-diameters instead of body-heights. Used by every
   * tight framing, because "head and shoulders" is a statement about the head.
   */
  headCoverage?: number;
  /** Horizontal angle from the subject's front, in radians. */
  yaw: number;
  /** Vertical angle above the aim point, in radians. */
  pitch: number;
  fov: number;
}

const FRAMINGS: Record<FramingPreset, FramingSpec> = {
  wide:                { coverage: 3.2,  aim: 0.55, yaw: 0.22,  pitch: 0.12,  fov: 44 },
  full:                { coverage: 1.35, aim: 0.5,  yaw: 0.18,  pitch: 0.06,  fov: 38 },
  medium:              { coverage: 0.9,  aim: 0.72, yaw: 0.2,   pitch: 0.02,  fov: 36, aimHead: true, headCoverage: 3.4 },
  'close-up':          { coverage: 0.62, aim: 0.9,  yaw: 0.14,  pitch: 0.0,   fov: 32, aimHead: true, headCoverage: 2.1 },
  'extreme-close-up':  { coverage: 0.4,  aim: 0.95, yaw: 0.08,  pitch: 0.0,   fov: 30, aimHead: true, headCoverage: 1.35 },
  'over-shoulder':     { coverage: 1.0,  aim: 0.86, yaw: 0.85,  pitch: 0.05,  fov: 34, aimHead: true, headCoverage: 3.0 },
  'low-angle':         { coverage: 1.1,  aim: 0.5,  yaw: 0.16,  pitch: -0.34, fov: 40 },
  'high-angle':        { coverage: 1.2,  aim: 0.62, yaw: 0.16,  pitch: 0.5,   fov: 40 },
  'two-shot':          { coverage: 1.9,  aim: 0.62, yaw: 0.04,  pitch: 0.03,  fov: 40 },
};

export const FRAMING_LABELS: Record<FramingPreset, string> = {
  wide: 'Wide — see the whole place',
  full: 'Full — head to toe',
  medium: 'Medium — waist up',
  'close-up': 'Close-up — head and shoulders',
  'extreme-close-up': 'Extreme close-up — just the face',
  'over-shoulder': 'Over the shoulder',
  'low-angle': 'Low angle — looking up (makes them look big)',
  'high-angle': 'High angle — looking down (makes them look small)',
  'two-shot': 'Two-shot — both characters',
};

export const MOVE_LABELS: Record<CameraMove, string> = {
  static: 'Hold still',
  'push-in': 'Push in — slowly move closer',
  'pull-out': 'Pull out — slowly move back',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right',
  orbit: 'Orbit around',
  'crane-up': 'Crane up',
  handheld: 'Handheld — gentle natural drift',
  follow: 'Follow the character',
};

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const _focus = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Compose a camera for one shot at normalised time `u` (0 at the cut in,
 * 1 at the cut out).
 */
export function composeShot(
  runtime: SceneRuntime,
  shot: Shot,
  u: number,
  aspect: number,
  out: CameraState = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 38 },
): CameraState {
  // An explicit camera node wins — this is the escape hatch for users who do
  // want to place cameras by hand.
  const named = shot.cameraId ? runtime.nodes.get(shot.cameraId) : null;
  if (named?.camera) {
    named.object.updateWorldMatrix(true, false);
    out.position.setFromMatrixPosition(named.camera.matrixWorld);
    _dir.set(0, 0, -1).applyQuaternion(named.camera.getWorldQuaternion(new THREE.Quaternion()));
    out.target.copy(out.position).add(_dir.multiplyScalar(5));
    out.fov = named.camera.fov;
    return out;
  }

  const spec = FRAMINGS[shot.framing ?? 'medium'];
  const targetId = shot.targetNodeId;
  const rt = targetId ? runtime.nodes.get(targetId) : null;

  // Subject height decides the distance; without a subject, frame the origin
  // as if it were a 1.6-unit character.
  let height = (rt?.character?.height ?? 1.6) * (rt?.object.scale.y ?? 1);
  if (rt && spec.aimHead && targetId) {
    // Tight shots track the real head, wherever the performance has put it.
    runtime.getNodeFocus(targetId, _focus);
  } else if (rt) {
    rt.object.getWorldPosition(_focus);
    // Aim by height above the subject's feet, not at its head — that's what
    // the classic shot sizes are measured from.
    _focus.y += height * spec.aim;
  } else {
    _focus.set(0, height * spec.aim, 0);
  }

  // A two-shot has to hold *both* people. Framing it on one subject and hoping
  // is how you get a video full of half-visible characters, so measure the
  // group and widen to fit it.
  let groupWidth = 0;
  if (shot.framing === 'two-shot') {
    let minX = Infinity;
    let maxX = -Infinity;
    let sumX = 0;
    let n = 0;
    let tallest = 0;
    for (const node of runtime.nodes.values()) {
      if (node.doc.kind !== 'character' || !node.object.visible) continue;
      node.object.getWorldPosition(_dir);
      minX = Math.min(minX, _dir.x);
      maxX = Math.max(maxX, _dir.x);
      sumX += _dir.x;
      n++;
      tallest = Math.max(tallest, (node.character?.height ?? 1.6) * node.object.scale.y);
    }
    if (n > 1) {
      groupWidth = maxX - minX;
      height = Math.max(height, tallest);
      _focus.x = sumX / n;
      _focus.y = height * spec.aim;
    }
  }

  const amount = shot.moveAmount ?? 1;
  const move = shot.move ?? 'static';

  // Vertical coverage the framing wants, converted to a distance for this FOV.
  let fov = spec.fov;
  let coverage = spec.coverage * height;
  if (spec.headCoverage && rt?.character) {
    coverage = spec.headCoverage * rt.character.headRadius * 2 * rt.object.scale.y;
  }
  // A 9:16 frame is much narrower; pull back so heads don't get cropped.
  if (aspect < 1) coverage *= 1.45;
  // Widen for the group: convert the horizontal span the shot must hold into
  // the vertical coverage the FOV maths works in, plus a margin either side.
  if (groupWidth > 0) {
    coverage = Math.max(coverage, ((groupWidth + height * 0.9) / aspect));
  }

  let yaw = spec.yaw;
  let pitch = spec.pitch;
  let dolly = 1;
  let offsetX = 0;
  let offsetY = 0;

  switch (move) {
    case 'push-in':
      dolly = 1 - 0.3 * amount * easeInOut(u);
      break;
    case 'pull-out':
      dolly = 1 + 0.42 * amount * easeInOut(u);
      break;
    case 'pan-left':
      yaw -= 0.55 * amount * easeInOut(u);
      break;
    case 'pan-right':
      yaw += 0.55 * amount * easeInOut(u);
      break;
    case 'orbit':
      yaw += (u - 0.5) * 1.5 * amount;
      break;
    case 'crane-up':
      pitch += 0.4 * amount * easeInOut(u);
      dolly = 1 + 0.15 * amount * u;
      break;
    case 'handheld': {
      // Layered noise, not a sine — a sine reads as a mechanical wobble.
      const s = u * 4;
      offsetX = fbm1(s, 11) * 0.06 * amount;
      offsetY = fbm1(s + 40, 23) * 0.05 * amount;
      yaw += fbm1(s + 80, 31) * 0.05 * amount;
      break;
    }
    case 'follow':
      // The focus point already tracks the subject; a slight lag sells it.
      dolly = 1 - 0.05 * Math.sin(u * Math.PI);
      break;
    case 'static':
    default:
      break;
  }

  const vFov = THREE.MathUtils.degToRad(fov);
  const distance = (coverage / 2 / Math.tan(vFov / 2)) * dolly;

  out.target.copy(_focus);
  out.target.x += offsetX;
  out.target.y += offsetY;

  const cosPitch = Math.cos(pitch);
  out.position.set(
    _focus.x + Math.sin(yaw) * cosPitch * distance + offsetX,
    _focus.y + Math.sin(pitch) * distance + offsetY,
    _focus.z + Math.cos(yaw) * cosPitch * distance,
  );
  out.fov = fov;
  return out;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Which shot is on screen at time `t`. Sequence must be sorted by start. */
export function shotAt(sequence: Shot[], t: number): { shot: Shot; index: number; u: number } | null {
  for (let i = 0; i < sequence.length; i++) {
    const s = sequence[i];
    if (t >= s.start && t < s.start + s.duration) {
      return { shot: s, index: i, u: s.duration > 0 ? (t - s.start) / s.duration : 0 };
    }
  }
  const last = sequence[sequence.length - 1];
  if (last && t >= last.start + last.duration) {
    return { shot: last, index: sequence.length - 1, u: 1 };
  }
  return sequence.length ? { shot: sequence[0], index: 0, u: 0 } : null;
}

/**
 * How much the incoming shot's transition covers the frame at time `t`.
 * Returns 0 when the transition is over.
 */
export function transitionProgress(shot: Shot, t: number): number {
  const tr = shot.transitionIn;
  if (!tr || tr.type === 'cut' || tr.duration <= 0) return 0;
  const elapsed = t - shot.start;
  if (elapsed < 0 || elapsed >= tr.duration) return 0;
  return 1 - elapsed / tr.duration;
}
