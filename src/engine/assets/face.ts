/**
 * The face rig.
 *
 * One face implementation serves every character in the library — bees, kids,
 * puppies, clouds. It exposes exactly the eight values in `FacePose` plus a
 * blended mouth shape, so the animation evaluator never needs to know what
 * species it's driving.
 *
 * The eyes blink by squashing in Y rather than by sliding a lid mesh. That's the
 * classic 2D-cartoon cheat, and on a rounded 3D head it reads better than a real
 * eyelid while costing one scale assignment instead of a morph target.
 */

import * as THREE from 'three';
import { PALETTE } from './palette';
import { flat, geo, shape, toon } from './materials';
import type { FacePose } from '../rig/expressions';
import { NEUTRAL_FACE } from '../rig/expressions';
import type { VisemeShape } from '../rig/visemes';
import { VISEMES } from '../rig/visemes';

export interface FaceOptions {
  /** Head radius the face is laid out against. */
  headRadius: number;
  /** Distance eyes sit apart, as a fraction of head radius. */
  eyeSpacing?: number;
  eyeSize?: number;
  irisColor?: number;
  skinColor?: number;
  /** Bugs and animals get no visible brows; kids do. */
  brows?: boolean;
  browColor?: number;
  /** Blush cheeks. On by default — it's most of the "friendly". */
  blush?: boolean;
  /** Push the whole face forward for a snouted animal. */
  faceDepth?: number;
  /** Big cartoon eyes sit slightly above centre. */
  eyeHeight?: number;
}

export interface FaceRig {
  group: THREE.Group;
  applyPose(pose: FacePose, mouth: VisemeShape, blinkAmount?: number): void;
  /** Aim the pupils at a world-space point — cheap, huge payoff for presence. */
  lookAt(target: THREE.Vector3 | null): void;
}

export function buildFace(opts: FaceOptions): FaceRig {
  const R = opts.headRadius;
  const eyeR = (opts.eyeSize ?? 0.32) * R;
  const spacing = (opts.eyeSpacing ?? 0.42) * R;
  const eyeY = (opts.eyeHeight ?? 0.12) * R;
  const faceZ = R * (opts.faceDepth ?? 0.82);
  const irisColor = opts.irisColor ?? PALETTE.iris;

  const group = new THREE.Group();
  group.name = 'face';

  /* ---- eyes ---- */
  const makeEye = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * spacing, eyeY, faceZ * 0.86);

    // Squash group: blink scales this, and only this.
    const squash = new THREE.Group();
    pivot.add(squash);

    const white = new THREE.Mesh(geo.sphere(eyeR, 20), flat(PALETTE.eyeWhite));
    white.scale.z = 0.6;
    squash.add(white);

    const pupilPivot = new THREE.Group();
    squash.add(pupilPivot);

    const iris = new THREE.Mesh(geo.sphere(eyeR * 0.56, 16), flat(irisColor));
    iris.position.z = eyeR * 0.44;
    iris.scale.z = 0.5;
    pupilPivot.add(iris);

    const pupil = new THREE.Mesh(geo.sphere(eyeR * 0.3, 14), flat(0x1a1420));
    pupil.position.z = eyeR * 0.58;
    pupil.scale.z = 0.5;
    pupilPivot.add(pupil);

    // Two highlights, unequal — one big, one small. Symmetrical catchlights
    // look like plastic; offset ones look alive.
    const hi1 = new THREE.Mesh(geo.sphere(eyeR * 0.2, 10), flat(PALETTE.white));
    hi1.position.set(-side * eyeR * 0.24, eyeR * 0.28, eyeR * 0.66);
    pupilPivot.add(hi1);
    const hi2 = new THREE.Mesh(geo.sphere(eyeR * 0.09, 8), flat(PALETTE.white));
    hi2.position.set(side * eyeR * 0.2, -eyeR * 0.2, eyeR * 0.64);
    pupilPivot.add(hi2);

    // A soft upper lash line gives the eye a top edge without an outline pass.
    const lash = new THREE.Mesh(geo.sphere(eyeR * 1.04, 16), flat(0x2c2436));
    lash.scale.set(1, 0.34, 0.62);
    lash.position.y = eyeR * 0.92;
    squash.add(lash);

    group.add(pivot);
    return { pivot, squash, pupilPivot, lash };
  };

  const leftEye = makeEye(1);
  const rightEye = makeEye(-1);

  /* ---- brows ---- */
  let leftBrow: THREE.Object3D | null = null;
  let rightBrow: THREE.Object3D | null = null;
  if (opts.brows !== false) {
    const browGeo = geo.capsule(eyeR * 0.13, eyeR * 0.9, 6);
    const browMat = toon(opts.browColor ?? 0x4a3728);
    const mk = (side: 1 | -1) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * spacing, eyeY + eyeR * 1.5, faceZ * 0.9);
      const bar = new THREE.Mesh(browGeo, browMat);
      bar.rotation.z = Math.PI / 2;
      pivot.add(bar);
      group.add(pivot);
      return pivot;
    };
    leftBrow = mk(1);
    rightBrow = mk(-1);
  }

  /* ---- mouth ---- */
  const mouthRoot = new THREE.Group();
  mouthRoot.position.set(0, -R * 0.36, faceZ * 0.9);
  group.add(mouthRoot);

  // The dark opening. Squashing this in Y takes it from "wide open" to a line,
  // which is the whole mouth animation in one scale channel.
  const mouthHole = new THREE.Mesh(geo.sphere(R * 0.3, 18), flat(PALETTE.mouthInner));
  mouthHole.scale.set(1, 0.12, 0.42);
  mouthRoot.add(mouthHole);

  const tongue = new THREE.Mesh(geo.sphere(R * 0.17, 12), flat(PALETTE.tongue));
  tongue.position.set(0, -R * 0.1, R * 0.06);
  tongue.scale.set(1, 0.5, 0.8);
  mouthRoot.add(tongue);

  const teeth = new THREE.Mesh(geo.box(R * 0.42, R * 0.08, R * 0.06), flat(PALETTE.teeth));
  teeth.position.set(0, R * 0.11, R * 0.14);
  mouthRoot.add(teeth);

  // Smile arc: a torus segment that curves up for happy, flips for sad. It sits
  // just under the opening so a closed happy mouth still reads as a smile.
  const arcGeo = new THREE.TorusGeometry(R * 0.26, R * 0.035, 8, 20, Math.PI);
  const smileArc = new THREE.Mesh(arcGeo, flat(0x5a3040));
  smileArc.rotation.z = Math.PI;
  smileArc.position.y = R * 0.02;
  mouthRoot.add(smileArc);

  /* ---- blush ---- */
  let leftBlush: THREE.Mesh | null = null;
  let rightBlush: THREE.Mesh | null = null;
  if (opts.blush !== false) {
    const blushMat = new THREE.MeshBasicMaterial({ color: PALETTE.blush, transparent: true, opacity: 0.5 });
    const mk = (side: 1 | -1) => {
      const m = new THREE.Mesh(geo.circle(R * 0.2, 16), blushMat.clone());
      m.position.set(side * R * 0.58, -R * 0.16, faceZ * 0.72);
      m.rotation.y = side * 0.5;
      group.add(m);
      return m;
    };
    leftBlush = mk(1);
    rightBlush = mk(-1);
  }

  /* ---- pose application ---- */
  const _worldPos = new THREE.Vector3();
  const _local = new THREE.Vector3();
  let lookTarget: THREE.Vector3 | null = null;

  const applyPose = (pose: FacePose, mouth: VisemeShape, blinkAmount = 0) => {
    // --- eyes ---
    const close = Math.min(1, pose.eyeClose + blinkAmount);
    const openScale = Math.max(0.04, 1 - close);
    const wideScale = 1 + pose.eyeWide * 0.22;
    for (const eye of [leftEye, rightEye]) {
      eye.squash.scale.set(wideScale, openScale * wideScale, 1);
      eye.lash.position.y = eyeR * (0.92 - close * 0.5);
    }

    // --- brows ---
    if (leftBrow && rightBrow) {
      const lift = pose.browRaise * eyeR * 0.55;
      leftBrow.position.y = eyeY + eyeR * 1.5 + lift;
      rightBrow.position.y = eyeY + eyeR * 1.5 + lift;
      // Inner ends rise for sadness, fall for a scowl.
      leftBrow.rotation.z = -pose.browTilt * 0.45 - pose.browRaise * 0.06;
      rightBrow.rotation.z = pose.browTilt * 0.45 + pose.browRaise * 0.06;
    }

    // --- mouth ---
    // Viseme opening plus whatever baseline the expression asks for.
    const open = Math.min(1.2, mouth.open + pose.mouthOpen * 0.8);
    const width = 1 + mouth.wide * 0.35 - mouth.round * 0.42 + Math.max(0, pose.smile) * 0.22;
    mouthHole.scale.set(
      Math.max(0.35, width),
      Math.max(0.1, open * 1.0),
      0.42 + mouth.round * 0.35,
    );
    mouthRoot.position.z = faceZ * 0.9 + mouth.round * R * 0.1;

    tongue.visible = open > 0.35;
    tongue.position.y = -R * 0.05 - open * R * 0.14;
    teeth.visible = mouth.teeth > 0.25;
    teeth.scale.setScalar(Math.max(0.2, mouth.teeth));
    teeth.position.y = R * 0.04 + open * R * 0.11;

    // The arc only shows when the mouth is near-closed; an open mouth already
    // carries the expression, and both at once looks like two mouths.
    const arcStrength = Math.max(0, 1 - open * 2.2);
    smileArc.visible = arcStrength > 0.05 && Math.abs(pose.smile) > 0.05;
    const curve = pose.smile;
    smileArc.scale.set(
      Math.max(0.4, width * 0.9),
      Math.max(0.25, Math.abs(curve) * 1.1) * arcStrength + 0.25,
      1,
    );
    // Flip the arc for a frown.
    smileArc.rotation.z = curve >= 0 ? Math.PI : 0;
    smileArc.position.y = curve >= 0 ? R * 0.02 : -R * 0.1;

    // --- blush ---
    if (leftBlush && rightBlush) {
      const o = 0.15 + pose.blush * 0.55;
      (leftBlush.material as THREE.MeshBasicMaterial).opacity = o;
      (rightBlush.material as THREE.MeshBasicMaterial).opacity = o;
    }

    // --- eye direction ---
    if (lookTarget) {
      for (const eye of [leftEye, rightEye]) {
        eye.pivot.getWorldPosition(_worldPos);
        _local.copy(lookTarget).sub(_worldPos).normalize();
        // Convert to the head's local frame so the pupils track when the head turns.
        const inv = eye.pivot.parent?.matrixWorld;
        if (inv) {
          _local.applyMatrix4(new THREE.Matrix4().copy(inv).invert().setPosition(0, 0, 0));
        }
        eye.pupilPivot.position.x = THREE.MathUtils.clamp(_local.x * eyeR * 0.5, -eyeR * 0.34, eyeR * 0.34);
        eye.pupilPivot.position.y = THREE.MathUtils.clamp(_local.y * eyeR * 0.4, -eyeR * 0.3, eyeR * 0.3);
      }
    } else {
      leftEye.pupilPivot.position.set(0, 0, 0);
      rightEye.pupilPivot.position.set(0, 0, 0);
    }
  };

  applyPose(NEUTRAL_FACE, VISEMES.REST, 0);

  return {
    group,
    applyPose,
    lookAt(target) {
      lookTarget = target ? target.clone() : null;
    },
  };
}

/** A nose — separate because half the cast doesn't have one. */
export function buildNose(kind: 'button' | 'snout' | 'beak', size: number, color: number): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === 'button') {
    const m = shape(geo.sphere(size * 0.28, 12), color, { outline: 0.05 });
    m.scale.set(1, 0.85, 0.9);
    g.add(m);
  } else if (kind === 'snout') {
    const muzzle = shape(geo.sphere(size * 0.5, 16), color, { outline: 0.04 });
    muzzle.scale.set(1.1, 0.8, 0.9);
    g.add(muzzle);
    const tip = new THREE.Mesh(geo.sphere(size * 0.2, 12), flat(0x3a2c30));
    tip.position.set(0, size * 0.12, size * 0.42);
    tip.scale.set(1.2, 0.85, 0.8);
    g.add(tip);
  } else {
    const beak = shape(geo.cone(size * 0.28, size * 0.6, 8), color, { outline: 0.05 });
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
  }
  return g;
}
