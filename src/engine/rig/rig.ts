/**
 * Rigs.
 *
 * A rig is a named tree of joints. Character builders hang geometry off those
 * joints, and the animation evaluator writes `rig.<jointId>.rx|ry|rz` straight
 * onto them, so a "wave" clip authored for one biped works on every biped.
 *
 * Joint ids are deliberately plain English (`leftHand`, not `mixamorig:LeftHand`)
 * because they show up in the timeline in front of teachers, not riggers.
 */

import type { Vec3 } from '../types';

export interface Joint {
  id: string;
  /** Parent joint id, or null for the root. */
  parent: string | null;
  /** Offset from the parent joint, in the parent's space. */
  offset: Vec3;
  /** Human-readable name shown in the rig picker. */
  label: string;
  /** Rest rotation, applied before any animation. */
  rest?: Vec3;
}

export type RigFamily =
  | 'biped'
  | 'quadruped'
  | 'winged-bug'
  | 'bird'
  | 'fish'
  | 'blob'
  | 'serpent';

export interface RigDef {
  id: RigFamily;
  label: string;
  description: string;
  joints: Joint[];
  /** Joint that head-turns and eye-lines are applied to. */
  headJoint: string;
  /** Joints an "idle breathing" pass gently animates. */
  breathJoints: string[];
}

const J = (id: string, parent: string | null, offset: Vec3, label: string, rest?: Vec3): Joint => ({
  id,
  parent,
  offset,
  label,
  rest,
});

/* ------------------------------------------------------------------ *
 * Biped — kids, adults, and anything that walks on two legs
 * ------------------------------------------------------------------ */

export const BIPED: RigDef = {
  id: 'biped',
  label: 'Two legs (person-shaped)',
  description: 'Children, grown-ups, and friendly upright creatures.',
  headJoint: 'head',
  breathJoints: ['chest', 'head'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('hips', 'root', [0, 0.78, 0], 'Hips'),
    J('spine', 'hips', [0, 0.16, 0], 'Lower back'),
    J('chest', 'spine', [0, 0.22, 0], 'Chest'),
    J('neck', 'chest', [0, 0.2, 0], 'Neck'),
    J('head', 'neck', [0, 0.12, 0], 'Head'),

    J('leftShoulder', 'chest', [0.2, 0.12, 0], 'Left shoulder'),
    J('leftElbow', 'leftShoulder', [0.26, 0, 0], 'Left elbow'),
    J('leftHand', 'leftElbow', [0.24, 0, 0], 'Left hand'),
    J('rightShoulder', 'chest', [-0.2, 0.12, 0], 'Right shoulder'),
    J('rightElbow', 'rightShoulder', [-0.26, 0, 0], 'Right elbow'),
    J('rightHand', 'rightElbow', [-0.24, 0, 0], 'Right hand'),

    J('leftHip', 'hips', [0.12, -0.05, 0], 'Left hip'),
    J('leftKnee', 'leftHip', [0, -0.34, 0], 'Left knee'),
    J('leftFoot', 'leftKnee', [0, -0.32, 0], 'Left foot'),
    J('rightHip', 'hips', [-0.12, -0.05, 0], 'Right hip'),
    J('rightKnee', 'rightHip', [0, -0.34, 0], 'Right knee'),
    J('rightFoot', 'rightKnee', [0, -0.32, 0], 'Right foot'),
  ],
};

/* ------------------------------------------------------------------ *
 * Winged bug — bees, ladybirds, butterflies
 * ------------------------------------------------------------------ */

export const WINGED_BUG: RigDef = {
  id: 'winged-bug',
  label: 'Winged bug',
  description: 'Bees, butterflies and ladybirds. Hovers instead of walking.',
  headJoint: 'head',
  breathJoints: ['thorax'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('thorax', 'root', [0, 1.1, 0], 'Body'),
    J('abdomen', 'thorax', [0, -0.28, -0.08], 'Lower body'),
    J('neck', 'thorax', [0, 0.22, 0.02], 'Neck'),
    J('head', 'neck', [0, 0.14, 0], 'Head'),
    J('leftAntenna', 'head', [0.09, 0.2, 0.02], 'Left antenna'),
    J('rightAntenna', 'head', [-0.09, 0.2, 0.02], 'Right antenna'),

    J('leftWing', 'thorax', [0.14, 0.14, -0.08], 'Left wing'),
    J('leftWingTip', 'leftWing', [0.32, 0.06, -0.02], 'Left wing tip'),
    J('rightWing', 'thorax', [-0.14, 0.14, -0.08], 'Right wing'),
    J('rightWingTip', 'rightWing', [-0.32, 0.06, -0.02], 'Right wing tip'),

    J('leftShoulder', 'thorax', [0.16, 0.02, 0.04], 'Left arm'),
    J('leftElbow', 'leftShoulder', [0.18, -0.08, 0], 'Left elbow'),
    J('leftHand', 'leftElbow', [0.16, -0.06, 0], 'Left hand'),
    J('rightShoulder', 'thorax', [-0.16, 0.02, 0.04], 'Right arm'),
    J('rightElbow', 'rightShoulder', [-0.18, -0.08, 0], 'Right elbow'),
    J('rightHand', 'rightElbow', [-0.16, -0.06, 0], 'Right hand'),

    J('leftLeg', 'abdomen', [0.1, -0.16, 0.02], 'Left leg'),
    J('leftFoot', 'leftLeg', [0.02, -0.18, 0], 'Left foot'),
    J('rightLeg', 'abdomen', [-0.1, -0.16, 0.02], 'Right leg'),
    J('rightFoot', 'rightLeg', [-0.02, -0.18, 0], 'Right foot'),
  ],
};

/* ------------------------------------------------------------------ *
 * Quadruped — puppies, kittens, rabbits, deer
 * ------------------------------------------------------------------ */

export const QUADRUPED: RigDef = {
  id: 'quadruped',
  label: 'Four legs (animal)',
  description: 'Puppies, kittens, bunnies, lambs — anything on four paws.',
  headJoint: 'head',
  breathJoints: ['chest'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('hips', 'root', [0, 0.44, -0.24], 'Hips'),
    J('spine', 'hips', [0, 0.02, 0.24], 'Back'),
    J('chest', 'spine', [0, 0.03, 0.24], 'Chest'),
    J('neck', 'chest', [0, 0.14, 0.16], 'Neck', [-0.35, 0, 0]),
    J('head', 'neck', [0, 0.16, 0.06], 'Head', [0.35, 0, 0]),
    J('leftEar', 'head', [0.08, 0.12, -0.02], 'Left ear'),
    J('rightEar', 'head', [-0.08, 0.12, -0.02], 'Right ear'),
    J('tail', 'hips', [0, 0.06, -0.16], 'Tail'),
    J('tailTip', 'tail', [0, 0.06, -0.18], 'Tail tip'),

    J('frontLeftHip', 'chest', [0.13, -0.04, 0.04], 'Front left leg'),
    J('frontLeftKnee', 'frontLeftHip', [0, -0.2, 0], 'Front left knee'),
    J('frontLeftFoot', 'frontLeftKnee', [0, -0.18, 0.02], 'Front left paw'),
    J('frontRightHip', 'chest', [-0.13, -0.04, 0.04], 'Front right leg'),
    J('frontRightKnee', 'frontRightHip', [0, -0.2, 0], 'Front right knee'),
    J('frontRightFoot', 'frontRightKnee', [0, -0.18, 0.02], 'Front right paw'),

    J('backLeftHip', 'hips', [0.13, -0.02, 0], 'Back left leg'),
    J('backLeftKnee', 'backLeftHip', [0, -0.2, -0.03], 'Back left knee'),
    J('backLeftFoot', 'backLeftKnee', [0, -0.18, 0.04], 'Back left paw'),
    J('backRightHip', 'hips', [-0.13, -0.02, 0], 'Back right leg'),
    J('backRightKnee', 'backRightHip', [0, -0.2, -0.03], 'Back right knee'),
    J('backRightFoot', 'backRightKnee', [0, -0.18, 0.04], 'Back right paw'),
  ],
};

/* ------------------------------------------------------------------ *
 * Bird
 * ------------------------------------------------------------------ */

export const BIRD: RigDef = {
  id: 'bird',
  label: 'Bird',
  description: 'Robins, bluebirds and chicks. Hops on the ground, flaps in the air.',
  headJoint: 'head',
  breathJoints: ['body'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('body', 'root', [0, 0.5, 0], 'Body'),
    J('neck', 'body', [0, 0.16, 0.04], 'Neck'),
    J('head', 'neck', [0, 0.12, 0.02], 'Head'),
    J('beak', 'head', [0, -0.01, 0.12], 'Beak'),
    J('tail', 'body', [0, -0.02, -0.2], 'Tail'),
    J('leftWing', 'body', [0.12, 0.06, 0], 'Left wing'),
    J('leftWingTip', 'leftWing', [0.24, 0, -0.02], 'Left wing tip'),
    J('rightWing', 'body', [-0.12, 0.06, 0], 'Right wing'),
    J('rightWingTip', 'rightWing', [-0.24, 0, -0.02], 'Right wing tip'),
    J('leftLeg', 'body', [0.06, -0.18, 0], 'Left leg'),
    J('leftFoot', 'leftLeg', [0, -0.14, 0.02], 'Left foot'),
    J('rightLeg', 'body', [-0.06, -0.18, 0], 'Right leg'),
    J('rightFoot', 'rightLeg', [0, -0.14, 0.02], 'Right foot'),
  ],
};

/* ------------------------------------------------------------------ *
 * Fish, blob and serpent — the "no limbs" family
 * ------------------------------------------------------------------ */

export const FISH: RigDef = {
  id: 'fish',
  label: 'Fish',
  description: 'Pond and sea creatures. Swims with a travelling wave down the spine.',
  headJoint: 'head',
  breathJoints: ['body'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('body', 'root', [0, 0.6, 0], 'Body'),
    J('head', 'body', [0, 0.02, 0.18], 'Head'),
    J('spine1', 'body', [0, 0, -0.16], 'Spine 1'),
    J('spine2', 'spine1', [0, 0, -0.14], 'Spine 2'),
    J('tail', 'spine2', [0, 0, -0.12], 'Tail'),
    J('leftFin', 'body', [0.12, -0.02, 0.02], 'Left fin'),
    J('rightFin', 'body', [-0.12, -0.02, 0.02], 'Right fin'),
    J('topFin', 'body', [0, 0.14, -0.02], 'Top fin'),
  ],
};

export const BLOB: RigDef = {
  id: 'blob',
  label: 'Blob / cloud',
  description: 'Clouds, jellies, and squishy fantasy friends. Squash-and-stretch only.',
  headJoint: 'body',
  breathJoints: ['body'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('body', 'root', [0, 0.6, 0], 'Body'),
    J('leftArm', 'body', [0.28, 0.02, 0], 'Left arm'),
    J('rightArm', 'body', [-0.28, 0.02, 0], 'Right arm'),
  ],
};

export const SERPENT: RigDef = {
  id: 'serpent',
  label: 'Serpent / caterpillar',
  description: 'Caterpillars, worms and friendly dragons — a chain that ripples.',
  headJoint: 'head',
  breathJoints: ['seg1'],
  joints: [
    J('root', null, [0, 0, 0], 'Root'),
    J('seg1', 'root', [0, 0.28, 0], 'Segment 1'),
    J('seg2', 'seg1', [0, 0, -0.26], 'Segment 2'),
    J('seg3', 'seg2', [0, 0, -0.26], 'Segment 3'),
    J('seg4', 'seg3', [0, 0, -0.26], 'Segment 4'),
    J('seg5', 'seg4', [0, 0, -0.26], 'Segment 5'),
    J('head', 'seg1', [0, 0.06, 0.26], 'Head'),
  ],
};

export const RIGS: Record<RigFamily, RigDef> = {
  biped: BIPED,
  'winged-bug': WINGED_BUG,
  quadruped: QUADRUPED,
  bird: BIRD,
  fish: FISH,
  blob: BLOB,
  serpent: SERPENT,
};

export function getRig(family: RigFamily): RigDef {
  return RIGS[family] ?? BIPED;
}

/** Joints in parent-before-child order, so a single pass can build the tree. */
export function topoJoints(rig: RigDef): Joint[] {
  const byId = new Map(rig.joints.map((j) => [j.id, j]));
  const out: Joint[] = [];
  const seen = new Set<string>();
  const visit = (j: Joint) => {
    if (seen.has(j.id)) return;
    if (j.parent) {
      const p = byId.get(j.parent);
      if (p) visit(p);
    }
    seen.add(j.id);
    out.push(j);
  };
  rig.joints.forEach(visit);
  return out;
}
