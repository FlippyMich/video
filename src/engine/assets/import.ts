/**
 * Importing models and animation from outside the studio.
 *
 * Covers the two things people actually arrive with:
 *
 *   - a **prop or set piece** from an asset library (TurboSquid, Sketchfab,
 *     Poly Haven, Kenney) as .glb or .gltf
 *   - a **character animation** from Mixamo, which exports a skinned mesh with
 *     a `mixamorig:*` skeleton
 *
 * A Mixamo clip is not directly usable here: its joints are named differently,
 * its rest pose is a T-pose rather than ours, and it is authored for a
 * realistically-proportioned human rather than a character whose head is a
 * third of its height. So the import *retargets* — it maps the source skeleton
 * onto our joint names and takes rotations only, discarding root translation
 * except on the hips. Rotations transfer between proportions; positions don't.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnimTrack } from '../types';
import type { RigFamily } from '../rig/rig';
import { getRig } from '../rig/rig';

/* ------------------------------------------------------------------ *
 * Joint name mapping
 * ------------------------------------------------------------------ */

/**
 * Source skeleton names we know how to read, mapped to our joint ids.
 *
 * Mixamo is the common case; the second column covers the Blender/Rigify and
 * VRM conventions, which come up almost as often and cost nothing to support.
 */
const JOINT_ALIASES: Record<string, string[]> = {
  hips: ['mixamorig:Hips', 'Hips', 'hips', 'J_Bip_C_Hips', 'pelvis'],
  spine: ['mixamorig:Spine', 'Spine', 'spine', 'J_Bip_C_Spine'],
  chest: ['mixamorig:Spine1', 'mixamorig:Spine2', 'Chest', 'chest', 'J_Bip_C_Chest', 'spine.001'],
  neck: ['mixamorig:Neck', 'Neck', 'neck', 'J_Bip_C_Neck'],
  head: ['mixamorig:Head', 'Head', 'head', 'J_Bip_C_Head'],

  leftShoulder: ['mixamorig:LeftArm', 'LeftArm', 'upper_arm.L', 'J_Bip_L_UpperArm'],
  leftElbow: ['mixamorig:LeftForeArm', 'LeftForeArm', 'forearm.L', 'J_Bip_L_LowerArm'],
  leftHand: ['mixamorig:LeftHand', 'LeftHand', 'hand.L', 'J_Bip_L_Hand'],
  rightShoulder: ['mixamorig:RightArm', 'RightArm', 'upper_arm.R', 'J_Bip_R_UpperArm'],
  rightElbow: ['mixamorig:RightForeArm', 'RightForeArm', 'forearm.R', 'J_Bip_R_LowerArm'],
  rightHand: ['mixamorig:RightHand', 'RightHand', 'hand.R', 'J_Bip_R_Hand'],

  leftHip: ['mixamorig:LeftUpLeg', 'LeftUpLeg', 'thigh.L', 'J_Bip_L_UpperLeg'],
  leftKnee: ['mixamorig:LeftLeg', 'LeftLeg', 'shin.L', 'J_Bip_L_LowerLeg'],
  leftFoot: ['mixamorig:LeftFoot', 'LeftFoot', 'foot.L', 'J_Bip_L_Foot'],
  rightHip: ['mixamorig:RightUpLeg', 'RightUpLeg', 'thigh.R', 'J_Bip_R_UpperLeg'],
  rightKnee: ['mixamorig:RightLeg', 'RightLeg', 'shin.R', 'J_Bip_R_LowerLeg'],
  rightFoot: ['mixamorig:RightFoot', 'RightFoot', 'foot.R', 'J_Bip_R_Foot'],
};

/** Reverse index: source name (lower-cased) → our joint id. */
const SOURCE_TO_JOINT = new Map<string, string>();
for (const [joint, aliases] of Object.entries(JOINT_ALIASES)) {
  for (const alias of aliases) SOURCE_TO_JOINT.set(alias.toLowerCase(), joint);
}

function mapJointName(sourceName: string): string | null {
  const direct = SOURCE_TO_JOINT.get(sourceName.toLowerCase());
  if (direct) return direct;
  // Mixamo sometimes prefixes with the armature name; try the tail.
  const tail = sourceName.split(/[:|]/).pop();
  if (tail) {
    const hit = SOURCE_TO_JOINT.get(tail.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

export interface ImportedModel {
  object: THREE.Object3D;
  /** Size after normalisation, in world units. */
  size: THREE.Vector3;
  animations: THREE.AnimationClip[];
  /** Warnings worth showing the user. */
  notes: string[];
}

/**
 * Load a .glb / .gltf and make it usable in a BloomStudio scene.
 *
 * Two things always need doing to a downloaded model, and skipping either is
 * why imported assets usually look wrong: they arrive at an arbitrary scale
 * (centimetres, inches, "whatever the artist worked in"), and they arrive
 * centred on their own origin rather than standing on the ground.
 */
export async function importModel(
  data: ArrayBuffer | string,
  options: { targetHeight?: number; standOnGround?: boolean } = {},
): Promise<ImportedModel> {
  const loader = new GLTFLoader();
  const notes: string[] = [];

  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      if (typeof data === 'string') loader.load(data, resolve as never, undefined, reject);
      else loader.parse(data, '', resolve as never, reject);
    },
  );

  const object = gltf.scene;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  if (options.targetHeight && size.y > 1e-6) {
    const scale = options.targetHeight / size.y;
    object.scale.multiplyScalar(scale);
    box.setFromObject(object);
    box.getSize(size);
    box.getCenter(centre);
    if (scale < 0.02 || scale > 50) {
      notes.push(
        `The model was scaled by ${scale.toFixed(3)}× to fit. It was probably authored in different units.`,
      );
    }
  }

  if (options.standOnGround !== false) {
    object.position.y -= box.min.y;
    object.position.x -= centre.x;
    object.position.z -= centre.z;
  }

  // Downloaded models routinely arrive with shadows off and materials set to
  // whatever the exporter defaulted to.
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  if (!gltf.animations.length) notes.push('No animation in this file — it will be a static prop.');

  return { object, size, animations: gltf.animations, notes };
}

/* ------------------------------------------------------------------ *
 * Retargeting
 * ------------------------------------------------------------------ */

export interface RetargetResult {
  tracks: AnimTrack[];
  duration: number;
  /** Joints in the source that we had no home for. */
  unmapped: string[];
  /** Our joints the source didn't drive. */
  undriven: string[];
  notes: string[];
}

/**
 * Convert an imported `AnimationClip` into BloomStudio animation tracks.
 *
 * Only rotations transfer. A Mixamo walk is authored on a figure roughly seven
 * heads tall; our children are four and our bee is barely two. Copying joint
 * *positions* onto those proportions dislocates every limb, whereas copying
 * rotations produces the same pose on a different body — which is what
 * retargeting means.
 *
 * The one exception is the hips, whose vertical travel carries the bob of a
 * walk cycle. That is scaled by the height ratio and applied to the node's
 * position instead.
 */
export function retargetClip(
  clip: THREE.AnimationClip,
  family: RigFamily,
  options: { fps?: number; heightRatio?: number; includeRootMotion?: boolean } = {},
): RetargetResult {
  const fps = options.fps ?? 30;
  const heightRatio = options.heightRatio ?? 1;
  const rig = getRig(family);
  const ourJoints = new Set(rig.joints.map((j) => j.id));

  const notes: string[] = [];
  const unmapped = new Set<string>();
  const driven = new Set<string>();

  // Group the clip's tracks by the joint they address.
  const byJoint = new Map<string, { quat?: THREE.KeyframeTrack; pos?: THREE.KeyframeTrack }>();
  for (const track of clip.tracks) {
    const [nodeName, property] = splitTrackName(track.name);
    const jointId = mapJointName(nodeName);
    if (!jointId) {
      unmapped.add(nodeName);
      continue;
    }
    if (!ourJoints.has(jointId)) {
      unmapped.add(nodeName);
      continue;
    }
    const entry = byJoint.get(jointId) ?? {};
    if (property === 'quaternion') entry.quat = track;
    else if (property === 'position') entry.pos = track;
    byJoint.set(jointId, entry);
  }

  if (!byJoint.size) {
    notes.push(
      'None of the joints in this animation could be matched. ' +
      'BloomStudio recognises Mixamo, Rigify and VRM skeletons.',
    );
    return { tracks: [], duration: clip.duration, unmapped: [...unmapped], undriven: [...ourJoints], notes };
  }

  const frames = Math.max(2, Math.ceil(clip.duration * fps));
  const out: AnimTrack[] = [];
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  const quat = new THREE.Quaternion();

  for (const [jointId, entry] of byJoint) {
    if (!entry.quat) continue;
    driven.add(jointId);
    const rx: { t: number; v: number }[] = [];
    const ry: { t: number; v: number }[] = [];
    const rz: { t: number; v: number }[] = [];

    const interpolant = entry.quat.createInterpolant();
    for (let f = 0; f < frames; f++) {
      const t = (f / fps);
      const values = interpolant.evaluate(Math.min(t, clip.duration)) as unknown as ArrayLike<number>;
      quat.set(values[0], values[1], values[2], values[3]);
      euler.setFromQuaternion(quat, 'XYZ');
      rx.push({ t, v: euler.x });
      ry.push({ t, v: euler.y });
      rz.push({ t, v: euler.z });
    }
    out.push({ channel: `rig.${jointId}.rx`, keys: rx });
    out.push({ channel: `rig.${jointId}.ry`, keys: ry });
    out.push({ channel: `rig.${jointId}.rz`, keys: rz });
  }

  if (options.includeRootMotion !== false) {
    const hips = byJoint.get('hips');
    if (hips?.pos) {
      const interpolant = hips.pos.createInterpolant();
      const base = interpolant.evaluate(0) as unknown as ArrayLike<number>;
      const baseY = base[1];
      const keys: { t: number; v: number }[] = [];
      for (let f = 0; f < frames; f++) {
        const t = f / fps;
        const values = interpolant.evaluate(Math.min(t, clip.duration)) as unknown as ArrayLike<number>;
        keys.push({ t, v: (values[1] - baseY) * heightRatio });
      }
      out.push({ channel: 'position.y', keys });
    }
  }

  const undriven = [...ourJoints].filter((j) => !driven.has(j) && j !== 'root');
  if (undriven.length > ourJoints.size * 0.5) {
    notes.push(
      `Only ${driven.size} of ${ourJoints.size} joints were driven. ` +
      'The result will still play, but expect the undriven parts to sit at rest.',
    );
  }
  if (unmapped.size) {
    notes.push(
      `${unmapped.size} source joints had no equivalent here (usually fingers and toes) and were ignored.`,
    );
  }

  return { tracks: out, duration: clip.duration, unmapped: [...unmapped], undriven, notes };
}

function splitTrackName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot + 1)];
}

/* ------------------------------------------------------------------ *
 * What the UI needs to know
 * ------------------------------------------------------------------ */

export const IMPORT_NOTES = {
  models: [
    'BloomStudio reads .glb and .gltf. Most libraries offer one or both; ' +
    'if you only have .fbx or .obj, convert it first — Blender exports glTF in two clicks.',
    'Models are scaled to a sensible height and stood on the ground automatically.',
    'An imported model keeps its own materials, so it will not match the house toon style. ' +
    'That is usually fine for a background prop and obvious on anything in the foreground.',
  ],
  animation: [
    'Mixamo animations work: download as glTF, or as FBX and convert.',
    'Only rotations are transferred. Mixamo characters are far taller in proportion, ' +
    'and copying joint positions onto these bodies would dislocate every limb.',
    'Fingers and toes are ignored — the characters here do not have them.',
    'Retargeted motion lands on the same timeline as everything else, so you can ' +
    'layer a wave on top of an imported walk.',
  ],
  licensing: [
    'Anything you import stays under its own licence. The studio does not change that, ' +
    'and a video is a distribution — check what you downloaded actually allows it.',
  ],
} as const;
