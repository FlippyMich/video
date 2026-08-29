/**
 * Action clips.
 *
 * These are the verbs a user picks from a menu ("wave", "hop", "look around")
 * and the script importer emits automatically. Each one is a *generator*: give
 * it a rig family, a start time and a duration and it bakes keyframes to fit.
 *
 * Everything here writes **offsets from the rest pose**, so clips layer. A
 * character can be walking and waving and breathing at once, and the evaluator
 * just adds the three together.
 */

import type { AnimTrack, Easing, Keyframe } from '../types';
import type { RigFamily } from '../rig/rig';

export type ActionId =
  | 'idle'
  | 'breathe'
  | 'walk'
  | 'run'
  | 'hop'
  | 'jump'
  | 'wave'
  | 'big-wave'
  | 'point'
  | 'present'
  | 'clap'
  | 'cheer'
  | 'dance'
  | 'spin'
  | 'nod'
  | 'shake-head'
  | 'think'
  | 'shrug'
  | 'lean-in'
  | 'look-around'
  | 'sniff'
  | 'listen'
  | 'taste'
  | 'touch-reach'
  | 'hover'
  | 'fly-forward'
  | 'flap'
  | 'land'
  | 'take-off'
  | 'wag-tail'
  | 'bounce'
  | 'wobble'
  | 'sit'
  | 'stand-up'
  | 'tiptoe'
  | 'gasp';

export interface ActionMeta {
  id: ActionId;
  label: string;
  /** Natural length in seconds; clips stretch or loop to the requested window. */
  naturalDuration: number;
  loops: boolean;
  /** Rig families this reads well on. Empty means "anything". */
  families?: RigFamily[];
  category: 'body' | 'gesture' | 'head' | 'flight' | 'reaction';
  hint: string;
}

export const ACTIONS: ActionMeta[] = [
  { id: 'idle', label: 'Idle', naturalDuration: 4, loops: true, category: 'body', hint: 'Gentle sway. Always on underneath everything else.' },
  { id: 'breathe', label: 'Breathe', naturalDuration: 3.4, loops: true, category: 'body', hint: 'Slow chest rise. Free "alive" for a standing character.' },
  { id: 'walk', label: 'Walk', naturalDuration: 1.0, loops: true, families: ['biped', 'quadruped', 'bird'], category: 'body', hint: 'Bouncy cartoon walk cycle.' },
  { id: 'run', label: 'Run', naturalDuration: 0.62, loops: true, families: ['biped', 'quadruped'], category: 'body', hint: 'Faster, leanier, bigger arm swing.' },
  { id: 'hop', label: 'Hop', naturalDuration: 0.6, loops: true, category: 'body', hint: 'Little repeated hops — very kid-friendly.' },
  { id: 'jump', label: 'Jump', naturalDuration: 1.0, loops: false, category: 'body', hint: 'Anticipate, leap, squash on landing.' },
  { id: 'wave', label: 'Wave', naturalDuration: 1.6, loops: false, category: 'gesture', hint: 'Friendly hello with one hand.' },
  { id: 'big-wave', label: 'Big wave', naturalDuration: 2.2, loops: false, category: 'gesture', hint: 'Both arms overhead. The intro wave.' },
  { id: 'point', label: 'Point', naturalDuration: 1.2, loops: false, category: 'gesture', hint: 'Points ahead — pairs with "look at this!".' },
  { id: 'present', label: 'Present', naturalDuration: 1.4, loops: false, category: 'gesture', hint: 'Open-palm "ta-da" toward something.' },
  { id: 'clap', label: 'Clap', naturalDuration: 1.2, loops: true, category: 'gesture', hint: 'Claps in time. Great for sing-alongs.' },
  { id: 'cheer', label: 'Cheer', naturalDuration: 1.5, loops: false, category: 'reaction', hint: 'Arms up, little jump, huge smile.' },
  { id: 'dance', label: 'Dance', naturalDuration: 2.0, loops: true, category: 'body', hint: 'Side-to-side groove with arm pumps.' },
  { id: 'spin', label: 'Spin', naturalDuration: 1.1, loops: false, category: 'body', hint: 'A full happy twirl.' },
  { id: 'nod', label: 'Nod yes', naturalDuration: 0.9, loops: false, category: 'head', hint: 'Two clear nods.' },
  { id: 'shake-head', label: 'Shake head no', naturalDuration: 1.0, loops: false, category: 'head', hint: 'Two clear shakes.' },
  { id: 'think', label: 'Think', naturalDuration: 2.0, loops: false, category: 'head', hint: 'Head tilt and a hand near the chin.' },
  { id: 'shrug', label: 'Shrug', naturalDuration: 1.2, loops: false, category: 'gesture', hint: 'Shoulders up, palms out.' },
  { id: 'lean-in', label: 'Lean in', naturalDuration: 1.0, loops: false, category: 'body', hint: 'Leans toward camera — "come closer, listen".' },
  { id: 'look-around', label: 'Look around', naturalDuration: 2.4, loops: false, category: 'head', hint: 'Searches left, then right.' },
  { id: 'sniff', label: 'Sniff', naturalDuration: 1.4, loops: false, category: 'reaction', hint: 'Leans in and sniffs. For the smell scene.' },
  { id: 'listen', label: 'Listen', naturalDuration: 1.6, loops: false, category: 'reaction', hint: 'Hand cupped to ear.' },
  { id: 'taste', label: 'Taste', naturalDuration: 1.6, loops: false, category: 'reaction', hint: 'Little nibble, then a delighted wiggle.' },
  { id: 'touch-reach', label: 'Reach & touch', naturalDuration: 1.5, loops: false, category: 'gesture', hint: 'Reaches out carefully with one hand.' },
  { id: 'hover', label: 'Hover', naturalDuration: 1.2, loops: true, families: ['winged-bug', 'bird'], category: 'flight', hint: 'Holds in the air, wings blurring.' },
  { id: 'fly-forward', label: 'Fly forward', naturalDuration: 1.0, loops: true, families: ['winged-bug', 'bird'], category: 'flight', hint: 'Leans into the direction of travel.' },
  { id: 'flap', label: 'Flap', naturalDuration: 0.16, loops: true, families: ['winged-bug', 'bird'], category: 'flight', hint: 'Fast wingbeat. Layer under hover or fly.' },
  { id: 'land', label: 'Land', naturalDuration: 0.9, loops: false, families: ['winged-bug', 'bird'], category: 'flight', hint: 'Drops, flares wings, settles.' },
  { id: 'take-off', label: 'Take off', naturalDuration: 0.9, loops: false, families: ['winged-bug', 'bird'], category: 'flight', hint: 'Crouch, spring, wings out.' },
  { id: 'wag-tail', label: 'Wag tail', naturalDuration: 0.5, loops: true, families: ['quadruped', 'bird'], category: 'body', hint: 'Happy tail wag.' },
  { id: 'bounce', label: 'Bounce', naturalDuration: 0.8, loops: true, category: 'body', hint: 'Squash-and-stretch bob in place.' },
  { id: 'wobble', label: 'Wobble', naturalDuration: 1.0, loops: true, category: 'body', hint: 'Jelly wobble — good for blobs and clouds.' },
  { id: 'sit', label: 'Sit down', naturalDuration: 1.2, loops: false, families: ['biped', 'quadruped'], category: 'body', hint: 'Lowers to sitting.' },
  { id: 'stand-up', label: 'Stand up', naturalDuration: 1.2, loops: false, families: ['biped', 'quadruped'], category: 'body', hint: 'Rises from sitting.' },
  { id: 'tiptoe', label: 'Tiptoe', naturalDuration: 1.4, loops: true, families: ['biped'], category: 'body', hint: 'Sneaky exaggerated creeping.' },
  { id: 'gasp', label: 'Gasp', naturalDuration: 0.8, loops: false, category: 'reaction', hint: 'Sharp pull-back of surprise.' },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ *
 * Baking helpers
 * ------------------------------------------------------------------ */

type Curve = Record<string, Keyframe[]>;

class Baker {
  curves: Curve = {};
  constructor(readonly start: number, readonly duration: number) {}

  /** `u` is normalised 0..1 across the clip. */
  key(channel: string, u: number, v: number, e?: Easing) {
    const list = (this.curves[channel] ??= []);
    const t = this.start + u * this.duration;
    const prev = list[list.length - 1];
    if (prev && Math.abs(prev.t - t) < 1e-5) { prev.v = v; if (e) prev.ease = e; return; }
    list.push(e ? { t, v, ease: e } : { t, v });
  }

  /** Sample a continuous function into `steps` keys. Cheaper than hand-keying cycles. */
  curve(channel: string, fn: (u: number) => number, steps = 12) {
    for (let i = 0; i <= steps; i++) this.key(channel, i / steps, fn(i / steps), 'easeInOut');
  }

  tracks(): AnimTrack[] {
    return Object.entries(this.curves)
      .filter(([, keys]) => keys.length > 0)
      .map(([channel, keys]) => ({ channel, keys }));
  }
}

const TAU = Math.PI * 2;

/** Arm joints differ per family; this keeps every clip from special-casing. */
function limbs(family: RigFamily) {
  switch (family) {
    case 'winged-bug':
      return { L: 'leftShoulder', R: 'rightShoulder', LE: 'leftElbow', RE: 'rightElbow', body: 'thorax', head: 'head', hips: 'thorax' };
    case 'quadruped':
      return { L: 'frontLeftHip', R: 'frontRightHip', LE: 'frontLeftKnee', RE: 'frontRightKnee', body: 'chest', head: 'head', hips: 'hips' };
    case 'bird':
      return { L: 'leftWing', R: 'rightWing', LE: 'leftWingTip', RE: 'rightWingTip', body: 'body', head: 'head', hips: 'body' };
    case 'fish':
      return { L: 'leftFin', R: 'rightFin', LE: 'leftFin', RE: 'rightFin', body: 'body', head: 'head', hips: 'body' };
    case 'blob':
      return { L: 'leftArm', R: 'rightArm', LE: 'leftArm', RE: 'rightArm', body: 'body', head: 'body', hips: 'body' };
    case 'serpent':
      return { L: 'seg2', R: 'seg3', LE: 'seg4', RE: 'seg5', body: 'seg1', head: 'head', hips: 'seg1' };
    case 'biped':
    default:
      return { L: 'leftShoulder', R: 'rightShoulder', LE: 'leftElbow', RE: 'rightElbow', body: 'chest', head: 'head', hips: 'hips' };
  }
}

export interface BakeOptions {
  start: number;
  duration: number;
  family: RigFamily;
  /** Scales the whole performance. 1 is normal, 1.6 is broad and silly. */
  intensity?: number;
  /** Mirror left/right — a character on the right of frame should wave with its near hand. */
  mirror?: boolean;
  /** Phase offset so two characters don't move in lockstep. */
  phase?: number;
}

/* ------------------------------------------------------------------ *
 * The clips themselves
 * ------------------------------------------------------------------ */

export function bakeAction(action: ActionId, opts: BakeOptions): AnimTrack[] {
  const { start, duration, family } = opts;
  const amp = opts.intensity ?? 1;
  const phase = opts.phase ?? 0;
  const m = opts.mirror ? -1 : 1;
  const b = new Baker(start, duration);
  const j = limbs(family);
  const meta = ACTION_BY_ID.get(action);
  // Looping clips run through however many cycles fit the window.
  const cycles = meta?.loops ? Math.max(1, Math.round(duration / (meta.naturalDuration || 1))) : 1;
  const steps = meta?.loops ? Math.max(12, cycles * 10) : 14;

  switch (action) {
    case 'idle': {
      b.curve(`rig.${j.body}.rz`, (u) => Math.sin((u * cycles + phase) * TAU) * 0.035 * amp, steps);
      b.curve(`rig.${j.head}.ry`, (u) => Math.sin((u * cycles + phase) * TAU * 0.7) * 0.09 * amp, steps);
      b.curve(`rig.${j.head}.rz`, (u) => Math.sin((u * cycles + phase) * TAU * 0.5 + 1) * 0.045 * amp, steps);
      b.curve('position.y', (u) => Math.sin((u * cycles + phase) * TAU) * 0.012 * amp, steps);
      break;
    }
    case 'breathe': {
      b.curve(`rig.${j.body}.rx`, (u) => -Math.sin((u * cycles + phase) * TAU) * 0.05 * amp, steps);
      b.curve('scale.y', (u) => Math.sin((u * cycles + phase) * TAU) * 0.018 * amp, steps);
      break;
    }
    case 'walk': {
      const f = (u: number, off = 0) => Math.sin((u * cycles + phase + off) * TAU);
      if (family === 'quadruped') {
        b.curve('rig.frontLeftHip.rx', (u) => f(u) * 0.55 * amp, steps);
        b.curve('rig.frontRightHip.rx', (u) => f(u, 0.5) * 0.55 * amp, steps);
        b.curve('rig.backLeftHip.rx', (u) => f(u, 0.5) * 0.55 * amp, steps);
        b.curve('rig.backRightHip.rx', (u) => f(u) * 0.55 * amp, steps);
        b.curve('rig.frontLeftKnee.rx', (u) => Math.max(0, -f(u, 0.15)) * 0.5 * amp, steps);
        b.curve('rig.frontRightKnee.rx', (u) => Math.max(0, -f(u, 0.65)) * 0.5 * amp, steps);
        b.curve('rig.tail.rz', (u) => f(u, 0.25) * 0.3 * amp, steps);
        b.curve('position.y', (u) => Math.abs(Math.cos((u * cycles + phase) * TAU)) * 0.035 * amp, steps);
      } else if (family === 'bird') {
        b.curve('rig.leftLeg.rx', (u) => f(u) * 0.5 * amp, steps);
        b.curve('rig.rightLeg.rx', (u) => f(u, 0.5) * 0.5 * amp, steps);
        b.curve('rig.body.rx', (u) => Math.abs(f(u)) * 0.12 * amp, steps);
        b.curve('position.y', (u) => Math.abs(Math.cos((u * cycles + phase) * TAU)) * 0.05 * amp, steps);
      } else {
        b.curve('rig.leftHip.rx', (u) => f(u) * 0.62 * amp, steps);
        b.curve('rig.rightHip.rx', (u) => -f(u) * 0.62 * amp, steps);
        b.curve('rig.leftKnee.rx', (u) => Math.max(0, -f(u, 0.12)) * 0.85 * amp, steps);
        b.curve('rig.rightKnee.rx', (u) => Math.max(0, f(u, 0.12)) * 0.85 * amp, steps);
        b.curve('rig.leftFoot.rx', (u) => f(u, 0.25) * 0.25 * amp, steps);
        b.curve('rig.rightFoot.rx', (u) => -f(u, 0.25) * 0.25 * amp, steps);
        b.curve(`rig.${j.L}.rx`, (u) => -f(u) * 0.5 * amp, steps);
        b.curve(`rig.${j.R}.rx`, (u) => f(u) * 0.5 * amp, steps);
        b.curve(`rig.${j.body}.ry`, (u) => f(u) * 0.09 * amp, steps);
        // Two bobs per stride — the up-down is what makes a walk cartoon.
        b.curve('position.y', (u) => Math.abs(Math.cos((u * cycles + phase) * TAU)) * 0.045 * amp, steps);
      }
      break;
    }
    case 'run': {
      const f = (u: number, off = 0) => Math.sin((u * cycles + phase + off) * TAU);
      b.curve('rig.leftHip.rx', (u) => f(u) * 1.0 * amp, steps);
      b.curve('rig.rightHip.rx', (u) => -f(u) * 1.0 * amp, steps);
      b.curve('rig.leftKnee.rx', (u) => Math.max(0, -f(u, 0.12)) * 1.3 * amp, steps);
      b.curve('rig.rightKnee.rx', (u) => Math.max(0, f(u, 0.12)) * 1.3 * amp, steps);
      b.curve(`rig.${j.L}.rx`, (u) => -f(u) * 0.9 * amp, steps);
      b.curve(`rig.${j.R}.rx`, (u) => f(u) * 0.9 * amp, steps);
      b.curve(`rig.${j.LE}.rz`, () => -0.9 * amp, 2);
      b.curve(`rig.${j.RE}.rz`, () => 0.9 * amp, 2);
      b.curve(`rig.${j.body}.rx`, () => 0.22 * amp, 2);
      b.curve('position.y', (u) => Math.abs(Math.cos((u * cycles + phase) * TAU)) * 0.09 * amp, steps);
      break;
    }
    case 'hop':
    case 'bounce': {
      const n = cycles;
      b.curve('position.y', (u) => Math.abs(Math.sin(u * n * Math.PI)) * (action === 'hop' ? 0.28 : 0.1) * amp, steps * 2);
      b.curve('scale.y', (u) => -Math.abs(Math.cos(u * n * Math.PI)) * 0.09 * amp + 0.045 * amp, steps * 2);
      b.curve('scale.x', (u) => Math.abs(Math.cos(u * n * Math.PI)) * 0.07 * amp - 0.035 * amp, steps * 2);
      if (family === 'biped') {
        b.curve('rig.leftKnee.rx', (u) => Math.abs(Math.cos(u * n * Math.PI)) * 0.5 * amp, steps * 2);
        b.curve('rig.rightKnee.rx', (u) => Math.abs(Math.cos(u * n * Math.PI)) * 0.5 * amp, steps * 2);
      }
      break;
    }
    case 'jump': {
      b.key('position.y', 0, 0, 'easeIn');
      b.key('position.y', 0.18, -0.09, 'easeOut');   // anticipate: crouch
      b.key('position.y', 0.5, 0.95 * amp, 'easeIn'); // apex
      b.key('position.y', 0.82, -0.07, 'easeOut');   // squash on landing
      b.key('position.y', 1, 0);
      b.key('scale.y', 0, 0); b.key('scale.y', 0.18, -0.14 * amp); b.key('scale.y', 0.34, 0.12 * amp);
      b.key('scale.y', 0.66, 0.08 * amp); b.key('scale.y', 0.82, -0.16 * amp); b.key('scale.y', 1, 0);
      b.key(`rig.${j.L}.rz`, 0, 0); b.key(`rig.${j.L}.rz`, 0.45, -1.5 * amp * m); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0, 0); b.key(`rig.${j.R}.rz`, 0.45, 1.5 * amp * m); b.key(`rig.${j.R}.rz`, 1, 0);
      break;
    }
    case 'wave': {
      const arm = opts.mirror ? j.R : j.L;
      const elbow = opts.mirror ? j.RE : j.LE;
      const s = opts.mirror ? -1 : 1;
      b.key(`rig.${arm}.rz`, 0, 0, 'easeOut');
      b.key(`rig.${arm}.rz`, 0.2, -2.1 * s * amp, 'easeInOut');
      b.key(`rig.${arm}.rz`, 0.85, -2.1 * s * amp, 'easeIn');
      b.key(`rig.${arm}.rz`, 1, 0);
      b.curve(`rig.${elbow}.rz`, (u) => (u > 0.2 && u < 0.85 ? Math.sin((u - 0.2) * 12) * 0.6 * s * amp : 0), 24);
      b.key(`rig.${j.head}.rz`, 0, 0); b.key(`rig.${j.head}.rz`, 0.4, 0.1 * s * amp); b.key(`rig.${j.head}.rz`, 1, 0);
      break;
    }
    case 'big-wave': {
      b.key(`rig.${j.L}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.L}.rz`, 0.18, -2.4 * amp); b.key(`rig.${j.L}.rz`, 0.9, -2.4 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.R}.rz`, 0.18, 2.4 * amp); b.key(`rig.${j.R}.rz`, 0.9, 2.4 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      b.curve(`rig.${j.body}.rz`, (u) => (u > 0.18 && u < 0.9 ? Math.sin((u - 0.18) * 9) * 0.18 * amp : 0), 26);
      b.curve('position.y', (u) => (u > 0.18 && u < 0.9 ? Math.abs(Math.sin((u - 0.18) * 9)) * 0.06 * amp : 0), 26);
      break;
    }
    case 'point': {
      const arm = opts.mirror ? j.R : j.L;
      const s = opts.mirror ? -1 : 1;
      b.key(`rig.${arm}.rz`, 0, 0, 'easeOut');
      b.key(`rig.${arm}.rz`, 0.14, 0.3 * s * amp, 'easeOut');  // wind up the other way
      b.key(`rig.${arm}.rz`, 0.32, -1.35 * s * amp, 'bounce');
      b.key(`rig.${arm}.rz`, 0.85, -1.3 * s * amp, 'easeIn');
      b.key(`rig.${arm}.rz`, 1, 0);
      b.key(`rig.${arm}.ry`, 0.32, -0.8 * s * amp); b.key(`rig.${arm}.ry`, 0.85, -0.8 * s * amp); b.key(`rig.${arm}.ry`, 1, 0);
      b.key(`rig.${j.body}.ry`, 0, 0); b.key(`rig.${j.body}.ry`, 0.32, -0.22 * s * amp); b.key(`rig.${j.body}.ry`, 1, 0);
      break;
    }
    case 'present': {
      b.key(`rig.${j.L}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.L}.rz`, 0.4, -1.0 * amp, 'bounce'); b.key(`rig.${j.L}.rz`, 0.85, -0.95 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.R}.rz`, 0.4, 1.0 * amp, 'bounce'); b.key(`rig.${j.R}.rz`, 0.85, 0.95 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      b.key(`rig.${j.LE}.rx`, 0.4, -0.5 * amp); b.key(`rig.${j.RE}.rx`, 0.4, -0.5 * amp);
      b.key(`rig.${j.body}.rx`, 0, 0); b.key(`rig.${j.body}.rx`, 0.4, -0.14 * amp); b.key(`rig.${j.body}.rx`, 1, 0);
      break;
    }
    case 'clap': {
      const f = (u: number) => Math.abs(Math.sin(u * cycles * Math.PI));
      b.curve(`rig.${j.L}.rz`, (u) => -0.9 * amp - f(u) * 0.5 * amp, steps * 2);
      b.curve(`rig.${j.R}.rz`, (u) => 0.9 * amp + f(u) * 0.5 * amp, steps * 2);
      b.curve(`rig.${j.LE}.rz`, (u) => -0.7 * amp + f(u) * 0.55 * amp, steps * 2);
      b.curve(`rig.${j.RE}.rz`, (u) => 0.7 * amp - f(u) * 0.55 * amp, steps * 2);
      b.curve('position.y', (u) => f(u) * 0.02 * amp, steps * 2);
      break;
    }
    case 'cheer': {
      b.key(`rig.${j.L}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.L}.rz`, 0.25, -2.7 * amp, 'bounce'); b.key(`rig.${j.L}.rz`, 0.8, -2.6 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.R}.rz`, 0.25, 2.7 * amp, 'bounce'); b.key(`rig.${j.R}.rz`, 0.8, 2.6 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      b.key('position.y', 0, 0, 'easeIn'); b.key('position.y', 0.14, -0.07); b.key('position.y', 0.42, 0.45 * amp, 'easeIn'); b.key('position.y', 0.7, 0); b.key('position.y', 0.78, -0.05); b.key('position.y', 1, 0);
      b.key(`rig.${j.head}.rx`, 0.35, -0.25 * amp); b.key(`rig.${j.head}.rx`, 1, 0);
      break;
    }
    case 'dance': {
      const f = (u: number, o = 0) => Math.sin((u * cycles + phase + o) * TAU);
      b.curve(`rig.${j.hips}.rz`, (u) => f(u) * 0.16 * amp, steps * 2);
      b.curve(`rig.${j.body}.rz`, (u) => -f(u) * 0.12 * amp, steps * 2);
      b.curve(`rig.${j.head}.rz`, (u) => f(u, 0.1) * 0.16 * amp, steps * 2);
      b.curve(`rig.${j.L}.rz`, (u) => -1.1 * amp + f(u, 0.25) * 0.7 * amp, steps * 2);
      b.curve(`rig.${j.R}.rz`, (u) => 1.1 * amp - f(u, 0.25) * 0.7 * amp, steps * 2);
      b.curve('position.y', (u) => Math.abs(f(u, 0.25)) * 0.06 * amp, steps * 2);
      b.curve('position.x', (u) => f(u) * 0.12 * amp, steps * 2);
      break;
    }
    case 'spin': {
      b.key('rotation.y', 0, 0, 'easeIn');
      b.key('rotation.y', 0.15, -0.4 * amp, 'easeInOut'); // wind up
      b.key('rotation.y', 0.85, TAU * amp, 'easeOut');
      b.key('rotation.y', 1, TAU);
      b.key('position.y', 0, 0); b.key('position.y', 0.5, 0.12 * amp); b.key('position.y', 1, 0);
      b.key(`rig.${j.L}.rz`, 0.5, -1.4 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0.5, 1.4 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      break;
    }
    case 'nod': {
      b.curve(`rig.${j.head}.rx`, (u) => Math.sin(u * TAU * 2) * 0.3 * amp * (1 - u * 0.3), 20);
      break;
    }
    case 'shake-head': {
      b.curve(`rig.${j.head}.ry`, (u) => Math.sin(u * TAU * 2) * 0.42 * amp * (1 - u * 0.3), 20);
      break;
    }
    case 'think': {
      const arm = opts.mirror ? j.R : j.L;
      const s = opts.mirror ? -1 : 1;
      b.key(`rig.${arm}.rz`, 0, 0, 'easeOut'); b.key(`rig.${arm}.rz`, 0.25, -1.5 * s * amp); b.key(`rig.${arm}.rz`, 0.8, -1.5 * s * amp); b.key(`rig.${arm}.rz`, 1, 0);
      b.key(`rig.${arm}.rx`, 0.25, -0.7 * amp); b.key(`rig.${arm}.rx`, 0.8, -0.7 * amp); b.key(`rig.${arm}.rx`, 1, 0);
      b.key(`rig.${j.head}.rz`, 0, 0); b.key(`rig.${j.head}.rz`, 0.3, 0.22 * s * amp); b.key(`rig.${j.head}.rz`, 0.8, 0.2 * s * amp); b.key(`rig.${j.head}.rz`, 1, 0);
      b.curve(`rig.${j.head}.ry`, (u) => (u > 0.3 && u < 0.8 ? Math.sin((u - 0.3) * 10) * 0.1 * amp : 0), 20);
      break;
    }
    case 'shrug': {
      b.key(`rig.${j.L}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.L}.rz`, 0.35, -0.55 * amp, 'bounce'); b.key(`rig.${j.L}.rz`, 0.75, -0.5 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.R}.rz`, 0.35, 0.55 * amp, 'bounce'); b.key(`rig.${j.R}.rz`, 0.75, 0.5 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      b.key(`rig.${j.LE}.rz`, 0.35, -1.3 * amp); b.key(`rig.${j.LE}.rz`, 1, 0);
      b.key(`rig.${j.RE}.rz`, 0.35, 1.3 * amp); b.key(`rig.${j.RE}.rz`, 1, 0);
      b.key(`rig.${j.head}.rz`, 0.35, 0.12 * amp); b.key(`rig.${j.head}.rz`, 1, 0);
      break;
    }
    case 'lean-in': {
      b.key(`rig.${j.body}.rx`, 0, 0, 'easeOut'); b.key(`rig.${j.body}.rx`, 0.3, 0.3 * amp); b.key(`rig.${j.body}.rx`, 0.8, 0.28 * amp); b.key(`rig.${j.body}.rx`, 1, 0);
      b.key('position.z', 0, 0, 'easeOut'); b.key('position.z', 0.3, 0.22 * amp); b.key('position.z', 0.8, 0.2 * amp); b.key('position.z', 1, 0);
      b.key(`rig.${j.head}.rx`, 0.3, -0.16 * amp); b.key(`rig.${j.head}.rx`, 1, 0);
      break;
    }
    case 'look-around': {
      b.key(`rig.${j.head}.ry`, 0, 0, 'easeInOut');
      b.key(`rig.${j.head}.ry`, 0.25, 0.65 * amp, 'easeInOut');
      b.key(`rig.${j.head}.ry`, 0.42, 0.6 * amp, 'easeInOut');
      b.key(`rig.${j.head}.ry`, 0.7, -0.65 * amp, 'easeInOut');
      b.key(`rig.${j.head}.ry`, 0.86, -0.6 * amp, 'easeInOut');
      b.key(`rig.${j.head}.ry`, 1, 0);
      b.key(`rig.${j.body}.ry`, 0.25, 0.18 * amp); b.key(`rig.${j.body}.ry`, 0.7, -0.18 * amp); b.key(`rig.${j.body}.ry`, 1, 0);
      break;
    }
    case 'sniff': {
      b.key(`rig.${j.body}.rx`, 0, 0, 'easeOut'); b.key(`rig.${j.body}.rx`, 0.28, 0.34 * amp); b.key(`rig.${j.body}.rx`, 0.75, 0.3 * amp); b.key(`rig.${j.body}.rx`, 1, 0);
      b.key(`rig.${j.head}.rx`, 0.28, 0.28 * amp); b.key(`rig.${j.head}.rx`, 0.75, 0.24 * amp); b.key(`rig.${j.head}.rx`, 1, 0);
      // Three quick sniffs, then a happy little lift.
      b.curve('position.z', (u) => (u > 0.3 && u < 0.72 ? Math.abs(Math.sin((u - 0.3) * 22)) * 0.05 * amp : 0), 26);
      b.key('scale.y', 0.3, 0); b.key('scale.y', 0.45, 0.05 * amp); b.key('scale.y', 0.6, 0); b.key('scale.y', 1, 0);
      break;
    }
    case 'listen': {
      const arm = opts.mirror ? j.R : j.L;
      const s = opts.mirror ? -1 : 1;
      b.key(`rig.${arm}.rz`, 0, 0, 'easeOut'); b.key(`rig.${arm}.rz`, 0.22, -2.0 * s * amp); b.key(`rig.${arm}.rz`, 0.82, -2.0 * s * amp); b.key(`rig.${arm}.rz`, 1, 0);
      b.key(`rig.${arm}.rx`, 0.22, -0.4 * amp); b.key(`rig.${arm}.rx`, 0.82, -0.4 * amp); b.key(`rig.${arm}.rx`, 1, 0);
      b.key(`rig.${j.head}.rz`, 0, 0); b.key(`rig.${j.head}.rz`, 0.3, -0.3 * s * amp); b.key(`rig.${j.head}.rz`, 0.82, -0.28 * s * amp); b.key(`rig.${j.head}.rz`, 1, 0);
      b.key(`rig.${j.head}.ry`, 0.3, 0.2 * s * amp); b.key(`rig.${j.head}.ry`, 1, 0);
      break;
    }
    case 'taste': {
      b.key(`rig.${j.L}.rz`, 0, 0, 'easeOut'); b.key(`rig.${j.L}.rz`, 0.2, -1.9 * amp); b.key(`rig.${j.L}.rz`, 0.5, -1.9 * amp); b.key(`rig.${j.L}.rz`, 0.8, 0);
      b.key(`rig.${j.head}.rx`, 0.25, 0.16 * amp); b.key(`rig.${j.head}.rx`, 0.5, 0.16 * amp); b.key(`rig.${j.head}.rx`, 0.7, -0.2 * amp); b.key(`rig.${j.head}.rx`, 1, 0);
      // The delighted wiggle after the bite.
      b.curve(`rig.${j.body}.rz`, (u) => (u > 0.6 ? Math.sin((u - 0.6) * 26) * 0.14 * amp : 0), 24);
      b.key('scale.y', 0.6, 0); b.key('scale.y', 0.72, 0.08 * amp); b.key('scale.y', 0.85, -0.04 * amp); b.key('scale.y', 1, 0);
      break;
    }
    case 'touch-reach': {
      const arm = opts.mirror ? j.R : j.L;
      const elbow = opts.mirror ? j.RE : j.LE;
      const s = opts.mirror ? -1 : 1;
      b.key(`rig.${arm}.rz`, 0, 0, 'easeOut'); b.key(`rig.${arm}.rz`, 0.35, -1.5 * s * amp, 'easeOut'); b.key(`rig.${arm}.rz`, 0.8, -1.45 * s * amp); b.key(`rig.${arm}.rz`, 1, 0);
      b.key(`rig.${arm}.ry`, 0.35, -1.0 * s * amp); b.key(`rig.${arm}.ry`, 0.8, -1.0 * s * amp); b.key(`rig.${arm}.ry`, 1, 0);
      b.key(`rig.${elbow}.ry`, 0.35, -0.4 * amp); b.key(`rig.${elbow}.ry`, 1, 0);
      // Tiny hesitation before contact — reads as "careful".
      b.key(`rig.${j.body}.rx`, 0.25, 0.1 * amp); b.key(`rig.${j.body}.rx`, 0.45, 0.2 * amp); b.key(`rig.${j.body}.rx`, 1, 0);
      break;
    }
    case 'hover': {
      b.curve('position.y', (u) => Math.sin((u * cycles + phase) * TAU) * 0.09 * amp, steps * 2);
      b.curve(`rig.${j.body}.rz`, (u) => Math.sin((u * cycles + phase) * TAU * 0.8) * 0.06 * amp, steps);
      b.curve(`rig.${j.head}.ry`, (u) => Math.sin((u * cycles + phase) * TAU * 0.55) * 0.12 * amp, steps);
      break;
    }
    case 'fly-forward': {
      b.curve('position.y', (u) => Math.sin((u * cycles + phase) * TAU) * 0.06 * amp, steps * 2);
      b.curve(`rig.${j.body}.rx`, () => 0.2 * amp, 2);
      b.curve(`rig.${j.body}.rz`, (u) => Math.sin((u * cycles + phase) * TAU * 0.6) * 0.1 * amp, steps);
      break;
    }
    case 'flap': {
      // Wingbeats are far too fast to key one-per-cycle at 30fps; we key the
      // envelope and let a high step count carry the blur.
      const beats = Math.max(2, Math.round(duration / 0.16));
      const f = (u: number) => Math.sin(u * beats * TAU);
      if (family === 'winged-bug') {
        b.curve('rig.leftWing.rz', (u) => -0.5 - f(u) * 0.8 * amp, beats * 6);
        b.curve('rig.rightWing.rz', (u) => 0.5 + f(u) * 0.8 * amp, beats * 6);
        b.curve('rig.leftWing.rx', (u) => f(u) * 0.25 * amp, beats * 6);
        b.curve('rig.rightWing.rx', (u) => f(u) * 0.25 * amp, beats * 6);
      } else {
        b.curve('rig.leftWing.rz', (u) => -f(u) * 0.9 * amp, beats * 6);
        b.curve('rig.rightWing.rz', (u) => f(u) * 0.9 * amp, beats * 6);
        b.curve('rig.leftWingTip.rz', (u) => -f(u) * 0.5 * amp, beats * 6);
        b.curve('rig.rightWingTip.rz', (u) => f(u) * 0.5 * amp, beats * 6);
      }
      break;
    }
    case 'land': {
      b.key('position.y', 0, 0.9 * amp, 'easeIn');
      b.key('position.y', 0.62, 0.02, 'easeOut');
      b.key('position.y', 0.74, -0.05 * amp);
      b.key('position.y', 1, 0);
      b.key('scale.y', 0.62, 0); b.key('scale.y', 0.74, -0.14 * amp); b.key('scale.y', 0.9, 0.04 * amp); b.key('scale.y', 1, 0);
      b.key(`rig.${j.L}.rz`, 0.5, -1.6 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0.5, 1.6 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      break;
    }
    case 'take-off': {
      b.key('position.y', 0, 0, 'easeIn');
      b.key('position.y', 0.2, -0.1 * amp, 'easeIn');
      b.key('position.y', 1, 0.95 * amp);
      b.key('scale.y', 0.2, -0.13 * amp); b.key('scale.y', 0.4, 0.1 * amp); b.key('scale.y', 1, 0);
      break;
    }
    case 'wag-tail': {
      const beats = Math.max(2, Math.round(duration / 0.25));
      b.curve('rig.tail.rz', (u) => Math.sin(u * beats * TAU) * 0.55 * amp, beats * 8);
      b.curve('rig.tailTip.rz', (u) => Math.sin((u * beats - 0.12) * TAU) * 0.4 * amp, beats * 8);
      break;
    }
    case 'wobble': {
      const f = (u: number, o = 0) => Math.sin((u * cycles + phase + o) * TAU);
      b.curve('scale.x', (u) => f(u) * 0.09 * amp, steps * 2);
      b.curve('scale.y', (u) => -f(u) * 0.09 * amp, steps * 2);
      b.curve(`rig.${j.body}.rz`, (u) => f(u, 0.25) * 0.1 * amp, steps * 2);
      break;
    }
    case 'sit': {
      b.key('position.y', 0, 0, 'easeInOut'); b.key('position.y', 0.75, -0.3 * amp); b.key('position.y', 1, -0.3 * amp);
      b.key('rig.leftHip.rx', 0, 0); b.key('rig.leftHip.rx', 0.75, -1.3 * amp); b.key('rig.leftHip.rx', 1, -1.3 * amp);
      b.key('rig.rightHip.rx', 0, 0); b.key('rig.rightHip.rx', 0.75, -1.3 * amp); b.key('rig.rightHip.rx', 1, -1.3 * amp);
      b.key('rig.leftKnee.rx', 0.75, 1.4 * amp); b.key('rig.leftKnee.rx', 1, 1.4 * amp);
      b.key('rig.rightKnee.rx', 0.75, 1.4 * amp); b.key('rig.rightKnee.rx', 1, 1.4 * amp);
      break;
    }
    case 'stand-up': {
      b.key('position.y', 0, -0.3 * amp, 'easeInOut'); b.key('position.y', 0.8, 0.03); b.key('position.y', 1, 0);
      b.key('rig.leftHip.rx', 0, -1.3 * amp); b.key('rig.leftHip.rx', 0.8, 0);
      b.key('rig.rightHip.rx', 0, -1.3 * amp); b.key('rig.rightHip.rx', 0.8, 0);
      b.key('rig.leftKnee.rx', 0, 1.4 * amp); b.key('rig.leftKnee.rx', 0.8, 0);
      b.key('rig.rightKnee.rx', 0, 1.4 * amp); b.key('rig.rightKnee.rx', 0.8, 0);
      break;
    }
    case 'tiptoe': {
      const f = (u: number, o = 0) => Math.sin((u * cycles + phase + o) * TAU);
      b.curve('rig.leftHip.rx', (u) => Math.max(0, f(u)) * 0.7 * amp, steps * 2);
      b.curve('rig.rightHip.rx', (u) => Math.max(0, -f(u)) * 0.7 * amp, steps * 2);
      b.curve('rig.leftKnee.rx', (u) => Math.max(0, f(u)) * 1.1 * amp, steps * 2);
      b.curve('rig.rightKnee.rx', (u) => Math.max(0, -f(u)) * 1.1 * amp, steps * 2);
      b.curve(`rig.${j.body}.rx`, () => 0.16 * amp, 2);
      b.curve(`rig.${j.L}.rz`, () => -1.2 * amp, 2);
      b.curve(`rig.${j.R}.rz`, () => 1.2 * amp, 2);
      b.curve('position.y', () => 0.05 * amp, 2);
      break;
    }
    case 'gasp': {
      b.key(`rig.${j.body}.rx`, 0, 0, 'easeOut'); b.key(`rig.${j.body}.rx`, 0.16, -0.28 * amp, 'easeOut'); b.key(`rig.${j.body}.rx`, 0.7, -0.2 * amp); b.key(`rig.${j.body}.rx`, 1, 0);
      b.key('position.z', 0, 0); b.key('position.z', 0.16, -0.14 * amp); b.key('position.z', 1, 0);
      b.key('scale.y', 0.16, 0.09 * amp); b.key('scale.y', 0.5, 0.05 * amp); b.key('scale.y', 1, 0);
      b.key(`rig.${j.L}.rz`, 0.2, -1.1 * amp); b.key(`rig.${j.L}.rz`, 1, 0);
      b.key(`rig.${j.R}.rz`, 0.2, 1.1 * amp); b.key(`rig.${j.R}.rz`, 1, 0);
      break;
    }
  }

  return b.tracks();
}

/** Merge baked track lists, concatenating keys on shared channels. */
export function mergeTracks(...groups: AnimTrack[][]): AnimTrack[] {
  const byChannel = new Map<string, Keyframe[]>();
  for (const group of groups) {
    for (const track of group) {
      const list = byChannel.get(track.channel);
      if (list) list.push(...track.keys);
      else byChannel.set(track.channel, [...track.keys]);
    }
  }
  return [...byChannel.entries()].map(([channel, keys]) => ({
    channel,
    keys: keys.sort((a, b) => a.t - b.t),
  }));
}
