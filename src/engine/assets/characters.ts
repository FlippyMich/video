/**
 * The character library.
 *
 * Every character is built from primitives at load time — there are no model
 * files to download, which means the whole cast is available instantly, works
 * offline, and diffs as a two-line change in the project JSON.
 *
 * A builder's job is: make the joint tree from the rig, hang geometry off the
 * joints, and hand back a `CharacterInstance` the evaluator can drive.
 */

import * as THREE from 'three';
import { PALETTE, CHARACTER_PALETTES, HAIR_COLOURS, SHIRT_COLOURS, SKIN_TONES, pick, shade } from './palette';
import { flat, geo, outline, shape, toon } from './materials';
import { buildFace, buildNose, type FaceRig } from './face';
import { getRig, topoJoints, type RigFamily } from '../rig/rig';

export interface CharacterInstance {
  root: THREE.Group;
  joints: Map<string, THREE.Object3D>;
  /** Rest rotation per joint, so animation channels can be pure offsets. */
  rest: Map<string, THREE.Euler>;
  face: FaceRig | null;
  rigFamily: RigFamily;
  /** Nominal standing height in world units — used for auto camera framing. */
  height: number;
  /** Objects that should spin fast (wings) even when no clip is playing. */
  idleSpinners: THREE.Object3D[];
}

export interface CharacterParams {
  skin?: number;
  hair?: number;
  hairStyle?: 'short' | 'bunches' | 'bob' | 'curly' | 'ponytail' | 'bald' | 'bun';
  shirt?: number;
  trousers?: number;
  bodyColor?: number;
  accentColor?: number;
  /** Deterministic variation seed for kids/crowd characters. */
  seed?: number;
  scale?: number;
}

/* ------------------------------------------------------------------ *
 * Skeleton
 * ------------------------------------------------------------------ */

function buildSkeleton(family: RigFamily) {
  const rig = getRig(family);
  const joints = new Map<string, THREE.Object3D>();
  const rest = new Map<string, THREE.Euler>();
  const root = new THREE.Group();
  root.name = 'characterRoot';

  for (const j of topoJoints(rig)) {
    const o = new THREE.Group();
    o.name = `joint:${j.id}`;
    o.position.set(...j.offset);
    const r = new THREE.Euler(j.rest?.[0] ?? 0, j.rest?.[1] ?? 0, j.rest?.[2] ?? 0);
    o.rotation.copy(r);
    rest.set(j.id, r.clone());
    joints.set(j.id, o);
    const parent = j.parent ? joints.get(j.parent) : null;
    (parent ?? root).add(o);
  }
  return { root, joints, rest, rig };
}

/** Attach a mesh to a joint at an optional local offset. */
function at(
  joints: Map<string, THREE.Object3D>,
  jointId: string,
  obj: THREE.Object3D,
  offset: [number, number, number] = [0, 0, 0],
): THREE.Object3D {
  obj.position.set(...offset);
  joints.get(jointId)?.add(obj);
  return obj;
}

/** Limb segment: a capsule aimed down the joint's local -Y, plus a ball end. */
function limbSegment(length: number, radius: number, color: number, ballColor?: number): THREE.Group {
  const g = new THREE.Group();
  const seg = shape(geo.capsule(radius, Math.max(0.01, length - radius * 2), 8), color, { outline: 0.05 });
  seg.position.y = -length / 2;
  g.add(seg);
  if (ballColor !== undefined) {
    const ball = shape(geo.sphere(radius * 1.4, 12), ballColor, { outline: 0.05 });
    ball.position.y = -length;
    g.add(ball);
  }
  return g;
}

/** Same idea, but pointing down the joint's +X — arms read better that way. */
function armSegment(length: number, radius: number, color: number, dir: 1 | -1, ballColor?: number): THREE.Group {
  const g = new THREE.Group();
  const seg = shape(geo.capsule(radius, Math.max(0.01, length - radius * 2), 8), color, { outline: 0.05 });
  seg.rotation.z = Math.PI / 2;
  seg.position.x = (dir * length) / 2;
  g.add(seg);
  if (ballColor !== undefined) {
    const ball = shape(geo.sphere(radius * 1.5, 12), ballColor, { outline: 0.05 });
    ball.position.x = dir * length;
    g.add(ball);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 * Bee — the show's lead
 * ------------------------------------------------------------------ */

function buildBee(p: CharacterParams, variant: 'buzzy' | 'plain' = 'buzzy'): CharacterInstance {
  const pal = CHARACTER_PALETTES.bee;
  const body = p.bodyColor ?? pal.body;
  const stripe = p.accentColor ?? pal.stripe;
  const { root, joints, rest } = buildSkeleton('winged-bug');

  /* thorax */
  const thorax = shape(geo.sphere(0.3, 22), body);
  thorax.scale.set(1.05, 0.95, 1);
  at(joints, 'thorax', thorax);
  // A fuzzy collar — the one detail that stops a bee reading as a beach ball.
  const fuzz = shape(geo.torus(0.27, 0.075, 18), shade(body, 0.35), { outline: 0.04 });
  fuzz.rotation.x = Math.PI / 2;
  at(joints, 'thorax', fuzz, [0, 0.16, 0]);

  /* abdomen with stripes */
  const abdomen = shape(geo.sphere(0.32, 22), body);
  abdomen.scale.set(0.92, 0.86, 1.12);
  at(joints, 'abdomen', abdomen, [0, -0.06, -0.06]);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(geo.torus(0.3 - i * 0.035, 0.062, 20), toon(stripe));
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(0.94, 0.94, 0.62);
    at(joints, 'abdomen', ring, [0, 0.04 - i * 0.135, -0.06 - i * 0.02]);
  }
  const stinger = shape(geo.cone(0.06, 0.16, 8), shade(stripe, 0.25), { outline: 0.06 });
  stinger.rotation.x = -Math.PI / 2 + 0.5;
  at(joints, 'abdomen', stinger, [0, -0.34, -0.2]);

  /* head + face */
  const headR = 0.34;
  const head = shape(geo.sphere(headR, 24), body);
  head.scale.set(1.05, 1, 0.98);
  at(joints, 'head', head);
  const face = buildFace({
    headRadius: headR,
    eyeSize: 0.42,
    eyeSpacing: 0.44,
    eyeHeight: 0.14,
    irisColor: 0x35507a,
    brows: true,
    browColor: shade(stripe, 0.15),
    faceDepth: 0.86,
  });
  at(joints, 'head', face.group);

  /* antennae */
  for (const [id, side] of [['leftAntenna', 1], ['rightAntenna', -1]] as const) {
    const stalk = shape(geo.capsule(0.022, 0.2, 6), stripe, { outline: 0.07 });
    stalk.rotation.z = -side * 0.35;
    stalk.position.set(side * 0.035, 0.1, 0);
    joints.get(id)?.add(stalk);
    const tip = shape(geo.sphere(0.055, 12), variant === 'buzzy' ? PALETTE.petalPink : stripe, { outline: 0.06 });
    tip.position.set(side * 0.09, 0.21, 0);
    joints.get(id)?.add(tip);
  }

  /* wings — translucent, unlit so they stay bright against any background */
  const idleSpinners: THREE.Object3D[] = [];
  for (const [id, side] of [['leftWing', 1], ['rightWing', -1]] as const) {
    const wingMat = new THREE.MeshBasicMaterial({
      color: pal.wing, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    const big = new THREE.Mesh(geo.petal(0.52, 0.3), wingMat);
    big.rotation.set(Math.PI / 2, 0, -side * 0.35);
    big.position.set(side * 0.24, 0.06, -0.06);
    const small = new THREE.Mesh(geo.petal(0.34, 0.2), wingMat);
    small.rotation.set(Math.PI / 2, 0, -side * 0.9);
    small.position.set(side * 0.18, 0.02, -0.16);
    const j = joints.get(id)!;
    j.add(big, small);
    // Rest pose lifts the wings so they read even on a still frame.
    j.rotation.z = side * 0.5;
    rest.set(id, j.rotation.clone());
    idleSpinners.push(j);
  }

  /* arms & legs */
  for (const [sh, el, side] of [['leftShoulder', 'leftElbow', 1], ['rightShoulder', 'rightElbow', -1]] as const) {
    joints.get(sh)!.add(armSegment(0.18, 0.045, stripe, side));
    joints.get(el)!.add(armSegment(0.16, 0.042, stripe, side, body));
    const j = joints.get(sh)!;
    j.rotation.z = -side * 0.7;
    rest.set(sh, j.rotation.clone());
  }
  for (const [lg, ft] of [['leftLeg', 'leftFoot'], ['rightLeg', 'rightFoot']] as const) {
    joints.get(lg)!.add(limbSegment(0.18, 0.04, stripe));
    const foot = shape(geo.sphere(0.075, 12), stripe, { outline: 0.05 });
    foot.scale.set(1.1, 0.65, 1.5);
    at(joints, ft, foot, [0, -0.02, 0.03]);
  }

  if (variant === 'buzzy') {
    // Buzzy's flower: the character's silhouette hook. A bee with a bloom.
    const flower = new THREE.Group();
    const centre = shape(geo.sphere(0.055, 12), PALETTE.honeyDeep, { outline: 0.06 });
    flower.add(centre);
    for (let i = 0; i < 6; i++) {
      const petal = shape(geo.petal(0.13, 0.075), PALETTE.petalPink, { outline: 0.06 });
      const a = (i / 6) * Math.PI * 2;
      petal.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, -0.01);
      petal.rotation.z = a - Math.PI / 2;
      flower.add(petal);
    }
    flower.rotation.set(-0.5, 0.3, 0.2);
    at(joints, 'head', flower, [0.2, 0.26, 0.06]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'winged-bug', height: 1.6, idleSpinners };
}

/* ------------------------------------------------------------------ *
 * Ladybird & butterfly — same rig, different silhouette
 * ------------------------------------------------------------------ */

function buildLadybird(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.ladybird;
  const body = p.bodyColor ?? pal.body;
  const { root, joints, rest } = buildSkeleton('winged-bug');

  const shell = shape(geo.sphere(0.4, 22), body);
  shell.scale.set(1.1, 0.85, 1.05);
  at(joints, 'thorax', shell, [0, -0.06, -0.04]);
  // Split line down the middle of the shell.
  const split = shape(geo.box(0.02, 0.02, 0.7), PALETTE.charcoal, { outline: false });
  at(joints, 'thorax', split, [0, 0.29, -0.04]);
  let s = (p.seed ?? 3) * 7.13;
  for (let i = 0; i < 7; i++) {
    s = (s * 9301 + 49297) % 233280;
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const r = 0.16 + ((s / 233280) * 0.14);
    const dot = new THREE.Mesh(geo.sphere(0.055 + (s / 233280) * 0.02, 10), toon(PALETTE.charcoal));
    dot.position.set(Math.cos(a) * r, 0.24 - Math.abs(Math.sin(a)) * 0.05, Math.sin(a) * r * 0.9 - 0.04);
    dot.scale.set(1, 0.4, 1);
    joints.get('thorax')!.add(dot);
  }

  const headR = 0.24;
  const head = shape(geo.sphere(headR, 20), PALETTE.charcoal);
  at(joints, 'head', head, [0, -0.04, 0.04]);
  const face = buildFace({
    headRadius: headR, eyeSize: 0.5, eyeSpacing: 0.46, eyeHeight: 0.16,
    irisColor: 0x2b2338, brows: false, faceDepth: 0.9,
  });
  at(joints, 'head', face.group, [0, -0.04, 0.04]);

  for (const [id, side] of [['leftAntenna', 1], ['rightAntenna', -1]] as const) {
    const stalk = shape(geo.capsule(0.018, 0.13, 6), PALETTE.charcoal, { outline: 0.08 });
    stalk.rotation.z = -side * 0.4;
    stalk.position.set(side * 0.03, 0.06, 0.02);
    joints.get(id)?.add(stalk);
    const tip = shape(geo.sphere(0.04, 10), PALETTE.charcoal, { outline: 0.07 });
    tip.position.set(side * 0.07, 0.14, 0.02);
    joints.get(id)?.add(tip);
  }

  const idleSpinners: THREE.Object3D[] = [];
  for (const [id, side] of [['leftWing', 1], ['rightWing', -1]] as const) {
    const mat = new THREE.MeshBasicMaterial({ color: pal.wing, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const w = new THREE.Mesh(geo.petal(0.44, 0.26), mat);
    w.rotation.set(Math.PI / 2, 0, -side * 0.4);
    w.position.set(side * 0.2, 0.04, -0.1);
    const j = joints.get(id)!;
    j.add(w);
    j.rotation.z = side * 0.55;
    rest.set(id, j.rotation.clone());
    idleSpinners.push(j);
  }

  for (const [sh, el, side] of [['leftShoulder', 'leftElbow', 1], ['rightShoulder', 'rightElbow', -1]] as const) {
    joints.get(sh)!.add(armSegment(0.16, 0.04, PALETTE.charcoal, side));
    joints.get(el)!.add(armSegment(0.14, 0.038, PALETTE.charcoal, side, PALETTE.charcoal));
    const j = joints.get(sh)!;
    j.rotation.z = -side * 0.6;
    rest.set(sh, j.rotation.clone());
  }
  for (const [lg, ft] of [['leftLeg', 'leftFoot'], ['rightLeg', 'rightFoot']] as const) {
    joints.get(lg)!.add(limbSegment(0.15, 0.035, PALETTE.charcoal));
    const foot = shape(geo.sphere(0.06, 10), PALETTE.charcoal, { outline: 0.06 });
    foot.scale.set(1, 0.7, 1.4);
    at(joints, ft, foot, [0, -0.01, 0.02]);
  }

  root.scale.setScalar(p.scale ?? 0.95);
  return { root, joints, rest, face, rigFamily: 'winged-bug', height: 1.5, idleSpinners };
}

function buildButterfly(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.butterfly;
  const body = p.bodyColor ?? pal.body;
  const wingColor = p.accentColor ?? pal.wing;
  const { root, joints, rest } = buildSkeleton('winged-bug');

  const thorax = shape(geo.capsule(0.12, 0.2, 12), body);
  at(joints, 'thorax', thorax);
  const abdomen = shape(geo.capsule(0.1, 0.22, 12), shade(body, -0.1));
  abdomen.rotation.x = 0.35;
  at(joints, 'abdomen', abdomen, [0, -0.1, -0.06]);

  const headR = 0.21;
  at(joints, 'head', shape(geo.sphere(headR, 20), body));
  const face = buildFace({ headRadius: headR, eyeSize: 0.46, eyeSpacing: 0.44, irisColor: 0x3a2b5c, brows: false });
  at(joints, 'head', face.group);

  for (const [id, side] of [['leftAntenna', 1], ['rightAntenna', -1]] as const) {
    const stalk = shape(geo.capsule(0.014, 0.16, 6), body, { outline: 0.09 });
    stalk.rotation.z = -side * 0.5;
    stalk.position.set(side * 0.045, 0.08, 0);
    joints.get(id)?.add(stalk);
    const tip = shape(geo.sphere(0.032, 8), pal.accent, { outline: 0.08 });
    tip.position.set(side * 0.11, 0.16, 0);
    joints.get(id)?.add(tip);
  }

  const idleSpinners: THREE.Object3D[] = [];
  for (const [id, side] of [['leftWing', 1], ['rightWing', -1]] as const) {
    const j = joints.get(id)!;
    const mkWing = (len: number, wide: number, color: number, y: number, z: number, rot: number, op: number) => {
      const mat = new THREE.MeshToonMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide });
      const w = new THREE.Mesh(geo.petal(len, wide), mat);
      w.rotation.set(Math.PI / 2, 0, -side * rot);
      w.position.set(side * len * 0.5, y, z);
      j.add(w);
      return w;
    };
    mkWing(0.62, 0.4, wingColor, 0.12, -0.02, 0.15, 0.95);
    mkWing(0.44, 0.3, pal.stripe, -0.16, -0.04, 0.75, 0.95);
    // Spots on the upper wing.
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(geo.circle(0.05 - i * 0.012, 10), flat(pal.accent, 0.9));
      dot.position.set(side * (0.28 + i * 0.12), 0.18 - i * 0.06, 0.01);
      j.add(dot);
    }
    j.rotation.z = side * 0.35;
    rest.set(id, j.rotation.clone());
    idleSpinners.push(j);
  }

  for (const [sh, el, side] of [['leftShoulder', 'leftElbow', 1], ['rightShoulder', 'rightElbow', -1]] as const) {
    joints.get(sh)!.add(armSegment(0.15, 0.032, body, side));
    joints.get(el)!.add(armSegment(0.13, 0.03, body, side, pal.accent));
    const j = joints.get(sh)!;
    j.rotation.z = -side * 0.65;
    rest.set(sh, j.rotation.clone());
  }
  for (const [lg, ft] of [['leftLeg', 'leftFoot'], ['rightLeg', 'rightFoot']] as const) {
    joints.get(lg)!.add(limbSegment(0.14, 0.03, body));
    at(joints, ft, shape(geo.sphere(0.05, 10), body, { outline: 0.06 }), [0, -0.01, 0.02]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'winged-bug', height: 1.5, idleSpinners };
}

/* ------------------------------------------------------------------ *
 * Kids & grown-ups
 * ------------------------------------------------------------------ */

function buildHuman(p: CharacterParams, kind: 'kid' | 'adult'): CharacterInstance {
  const seed = p.seed ?? 1;
  const skin = p.skin ?? pick(SKIN_TONES, seed * 3);
  const hair = p.hair ?? pick(HAIR_COLOURS, seed * 5 + 1);
  const shirt = p.shirt ?? pick(SHIRT_COLOURS, seed * 7 + 2);
  const trousers = p.trousers ?? shade(pick(SHIRT_COLOURS, seed * 11 + 4), -0.35);
  const styles = ['short', 'bunches', 'bob', 'curly', 'ponytail', 'bun'] as const;
  const hairStyle = p.hairStyle ?? pick(styles, seed * 13 + 3);

  const { root, joints, rest } = buildSkeleton('biped');

  // Kids get the classic 1:3 head-to-body ratio; adults a subtler 1:5.
  const headR = kind === 'kid' ? 0.36 : 0.3;
  const bodyScale = kind === 'kid' ? 0.86 : 1;
  joints.get('hips')!.position.y = kind === 'kid' ? 0.62 : 0.78;

  /* torso */
  const torso = shape(geo.capsule(0.2 * bodyScale, 0.22 * bodyScale, 14), shirt);
  at(joints, 'chest', torso, [0, -0.02, 0]);
  const hipBlock = shape(geo.capsule(0.17 * bodyScale, 0.08, 12), trousers);
  at(joints, 'hips', hipBlock, [0, 0.02, 0]);
  // Collar ring reads as a t-shirt neckline.
  const collar = shape(geo.torus(0.1 * bodyScale, 0.03, 14), shade(shirt, -0.2), { outline: 0.05 });
  collar.rotation.x = Math.PI / 2;
  at(joints, 'neck', collar, [0, -0.02, 0]);
  at(joints, 'neck', shape(geo.capsule(0.06, 0.06, 10), skin, { outline: 0.06 }), [0, 0.04, 0]);

  /* head */
  const head = shape(geo.sphere(headR, 24), skin);
  head.scale.set(0.98, 1.04, 0.95);
  at(joints, 'head', head, [0, headR * 0.55, 0]);

  const faceGroup = new THREE.Group();
  faceGroup.position.y = headR * 0.55;
  const face = buildFace({
    headRadius: headR,
    eyeSize: kind === 'kid' ? 0.34 : 0.28,
    eyeSpacing: 0.42,
    eyeHeight: kind === 'kid' ? 0.02 : 0.06,
    skinColor: skin,
    irisColor: pick([0x3f2d5c, 0x2f5d4e, 0x5a3a22, 0x2d4a7a], seed * 17),
    browColor: shade(hair, -0.15),
    faceDepth: 0.84,
  });
  faceGroup.add(face.group);
  const nose = buildNose('button', headR, shade(skin, -0.12));
  nose.position.set(0, -headR * 0.06, headR * 0.85);
  faceGroup.add(nose);
  // Ears.
  for (const side of [1, -1]) {
    const ear = shape(geo.sphere(headR * 0.19, 10), skin, { outline: 0.05 });
    ear.scale.set(0.5, 1, 0.9);
    ear.position.set(side * headR * 0.94, -headR * 0.02, 0);
    faceGroup.add(ear);
  }
  joints.get('head')!.add(faceGroup);

  /* hair */
  const hairGroup = new THREE.Group();
  hairGroup.position.y = headR * 0.55;
  const capMat = toon(hair);
  if (hairStyle !== 'bald') {
    const cap = new THREE.Mesh(geo.sphere(headR * 1.06, 20), capMat);
    cap.scale.set(1, 1.02, 1);
    // Cut the cap to a fringe by pushing it back and up.
    cap.position.set(0, headR * 0.14, -headR * 0.06);
    outline(cap, 0.03);
    hairGroup.add(cap);
    const fringe = new THREE.Mesh(geo.sphere(headR * 0.98, 18), capMat);
    fringe.scale.set(1.02, 0.42, 1.02);
    fringe.position.set(0, headR * 0.6, headR * 0.05);
    outline(fringe, 0.04);
    hairGroup.add(fringe);
  }
  const puff = (x: number, y: number, z: number, r: number) => {
    const m = new THREE.Mesh(geo.sphere(r, 14), capMat);
    outline(m, 0.05);
    m.position.set(x, y, z);
    hairGroup.add(m);
    return m;
  };
  if (hairStyle === 'bunches') {
    puff(headR * 1.05, headR * 0.35, -headR * 0.1, headR * 0.34);
    puff(-headR * 1.05, headR * 0.35, -headR * 0.1, headR * 0.34);
  } else if (hairStyle === 'ponytail') {
    puff(0, headR * 0.2, -headR * 1.1, headR * 0.4).scale.set(0.8, 1.3, 0.9);
  } else if (hairStyle === 'bun') {
    puff(0, headR * 0.95, -headR * 0.55, headR * 0.35);
  } else if (hairStyle === 'bob') {
    const bob = new THREE.Mesh(geo.sphere(headR * 1.12, 18), capMat);
    bob.scale.set(1, 0.95, 1);
    bob.position.set(0, -headR * 0.05, -headR * 0.05);
    outline(bob, 0.03);
    hairGroup.add(bob);
  } else if (hairStyle === 'curly') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      puff(Math.cos(a) * headR * 0.82, headR * 0.55 + Math.sin(a * 2) * headR * 0.16, Math.sin(a) * headR * 0.82 - headR * 0.05, headR * 0.3);
    }
  }
  joints.get('head')!.add(hairGroup);

  /* arms */
  for (const [sh, el, hd, side] of [
    ['leftShoulder', 'leftElbow', 'leftHand', 1],
    ['rightShoulder', 'rightElbow', 'rightHand', -1],
  ] as const) {
    joints.get(sh)!.add(armSegment(0.24 * bodyScale, 0.062 * bodyScale, shirt, side));
    joints.get(el)!.add(armSegment(0.22 * bodyScale, 0.055 * bodyScale, skin, side));
    const hand = shape(geo.sphere(0.078 * bodyScale, 12), skin, { outline: 0.05 });
    hand.scale.set(1, 1.1, 0.75);
    at(joints, hd, hand);
    // Arms hang, they don't stick out sideways.
    const j = joints.get(sh)!;
    j.rotation.z = -side * 1.22;
    j.rotation.x = 0.1;
    rest.set(sh, j.rotation.clone());
  }

  /* legs */
  for (const [hp, kn, ft, side] of [
    ['leftHip', 'leftKnee', 'leftFoot', 1],
    ['rightHip', 'rightKnee', 'rightFoot', -1],
  ] as const) {
    joints.get(hp)!.add(limbSegment(0.32 * bodyScale, 0.072 * bodyScale, trousers));
    joints.get(kn)!.add(limbSegment(0.3 * bodyScale, 0.062 * bodyScale, trousers));
    const shoe = shape(geo.capsule(0.075 * bodyScale, 0.07, 10), shade(trousers, -0.4), { outline: 0.05 });
    shoe.rotation.x = Math.PI / 2;
    at(joints, ft, shoe, [0, -0.03, 0.05 * side * 0 + 0.04]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return {
    root, joints, rest, face, rigFamily: 'biped',
    height: kind === 'kid' ? 1.35 : 1.75,
    idleSpinners: [],
  };
}

/* ------------------------------------------------------------------ *
 * Quadrupeds
 * ------------------------------------------------------------------ */

function buildQuadruped(p: CharacterParams, kind: 'puppy' | 'kitten' | 'bunny'): CharacterInstance {
  const pal = CHARACTER_PALETTES[kind];
  const body = p.bodyColor ?? pal.body;
  const accent = p.accentColor ?? pal.accent;
  const { root, joints, rest } = buildSkeleton('quadruped');

  const chest = shape(geo.capsule(0.2, 0.16, 14), body);
  chest.rotation.x = Math.PI / 2;
  at(joints, 'chest', chest);
  const belly = shape(geo.capsule(0.19, 0.2, 14), body);
  belly.rotation.x = Math.PI / 2;
  at(joints, 'spine', belly, [0, -0.01, 0]);
  const rump = shape(geo.sphere(0.2, 16), body);
  at(joints, 'hips', rump, [0, 0.02, -0.02]);

  const headR = 0.24;
  const head = shape(geo.sphere(headR, 22), body);
  at(joints, 'head', head, [0, 0.04, 0.02]);
  const face = buildFace({
    headRadius: headR,
    eyeSize: 0.44, eyeSpacing: 0.44, eyeHeight: 0.2,
    irisColor: 0x3a2a22, brows: false, faceDepth: 0.9,
  });
  at(joints, 'head', face.group, [0, 0.04, 0.02]);
  const snout = buildNose('snout', headR, kind === 'bunny' ? shade(body, 0.1) : shade(body, 0.15));
  snout.position.set(0, -headR * 0.18, headR * 0.9);
  snout.scale.setScalar(kind === 'bunny' ? 0.7 : 1);
  joints.get('head')!.add(snout);

  /* ears — the thing that distinguishes the three */
  for (const [id, side] of [['leftEar', 1], ['rightEar', -1]] as const) {
    const j = joints.get(id)!;
    if (kind === 'bunny') {
      const ear = shape(geo.capsule(0.055, 0.34, 10), body, { outline: 0.05 });
      ear.position.y = 0.2;
      const inner = new THREE.Mesh(geo.capsule(0.032, 0.26, 8), flat(PALETTE.petalBlush));
      inner.position.set(0, 0.2, 0.035);
      j.add(ear, inner);
      j.rotation.z = side * 0.2;
    } else if (kind === 'kitten') {
      const ear = shape(geo.cone(0.09, 0.16, 4), body, { outline: 0.06 });
      ear.position.y = 0.09;
      const inner = new THREE.Mesh(geo.cone(0.05, 0.1, 4), flat(PALETTE.petalBlush));
      inner.position.set(0, 0.09, 0.03);
      j.add(ear, inner);
      j.rotation.z = side * 0.28;
    } else {
      const ear = shape(geo.capsule(0.055, 0.12, 8), shade(body, -0.2), { outline: 0.05 });
      ear.position.y = -0.02;
      ear.scale.set(1, 1, 0.55);
      j.add(ear);
      j.rotation.z = side * 0.5;
      j.rotation.x = 0.3;
    }
    rest.set(id, j.rotation.clone());
  }

  /* tail */
  if (kind === 'bunny') {
    at(joints, 'tail', shape(geo.sphere(0.09, 12), PALETTE.white, { outline: 0.05 }));
  } else {
    joints.get('tail')!.add(limbSegment(0.14, 0.04, shade(body, -0.1)));
    const tip = shape(geo.sphere(0.055, 10), kind === 'kitten' ? shade(body, 0.25) : body, { outline: 0.05 });
    at(joints, 'tailTip', tip, [0, -0.04, 0]);
    const j = joints.get('tail')!;
    j.rotation.x = -0.9;
    rest.set('tail', j.rotation.clone());
  }

  /* legs */
  for (const id of ['frontLeftHip', 'frontRightHip', 'backLeftHip', 'backRightHip']) {
    joints.get(id)!.add(limbSegment(0.18, 0.055, body));
  }
  for (const id of ['frontLeftKnee', 'frontRightKnee', 'backLeftKnee', 'backRightKnee']) {
    joints.get(id)!.add(limbSegment(0.16, 0.05, body));
  }
  for (const id of ['frontLeftFoot', 'frontRightFoot', 'backLeftFoot', 'backRightFoot']) {
    const paw = shape(geo.sphere(0.072, 12), shade(body, kind === 'bunny' ? 0.05 : -0.12), { outline: 0.05 });
    paw.scale.set(1, 0.75, 1.25);
    at(joints, id, paw, [0, -0.02, 0.02]);
  }

  // Collar — reads as "this is a pet character, not wildlife".
  if (kind !== 'bunny') {
    const collar = shape(geo.torus(0.15, 0.028, 16), accent, { outline: 0.05 });
    collar.rotation.x = Math.PI / 2 - 0.35;
    at(joints, 'neck', collar, [0, 0.02, 0.02]);
    const tag = shape(geo.sphere(0.045, 10), PALETTE.honey, { outline: 0.06 });
    tag.scale.set(1, 1, 0.5);
    at(joints, 'neck', tag, [0, -0.08, 0.14]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'quadruped', height: 0.8, idleSpinners: [] };
}

/* ------------------------------------------------------------------ *
 * Bird, frog, cloud, caterpillar, fish
 * ------------------------------------------------------------------ */

function buildBird(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.bird;
  const body = p.bodyColor ?? pal.body;
  const { root, joints, rest } = buildSkeleton('bird');

  const torso = shape(geo.sphere(0.24, 20), body);
  torso.scale.set(1, 1.15, 1.05);
  at(joints, 'body', torso);
  const belly = shape(geo.sphere(0.19, 16), PALETTE.offWhite, { outline: false });
  belly.scale.set(0.9, 1, 0.7);
  at(joints, 'body', belly, [0, -0.04, 0.12]);

  const headR = 0.19;
  at(joints, 'head', shape(geo.sphere(headR, 20), body));
  const face = buildFace({ headRadius: headR, eyeSize: 0.46, eyeSpacing: 0.5, eyeHeight: 0.15, irisColor: 0x241d2e, brows: false, faceDepth: 0.85 });
  at(joints, 'head', face.group);
  const beak = buildNose('beak', headR * 1.5, pal.accent);
  beak.position.set(0, -headR * 0.15, headR * 0.95);
  joints.get('beak')!.add(beak);

  const idleSpinners: THREE.Object3D[] = [];
  for (const [id, tip, side] of [['leftWing', 'leftWingTip', 1], ['rightWing', 'rightWingTip', -1]] as const) {
    const w = shape(geo.petal(0.3, 0.16), shade(body, -0.12), { outline: 0.05 });
    w.rotation.set(Math.PI / 2, 0, -side * 1.35);
    w.position.set(side * 0.14, 0, -0.02);
    joints.get(id)!.add(w);
    const t = shape(geo.petal(0.2, 0.1), shade(body, -0.2), { outline: 0.06 });
    t.rotation.set(Math.PI / 2, 0, -side * 1.5);
    t.position.set(side * 0.1, -0.02, -0.02);
    joints.get(tip)!.add(t);
    const j = joints.get(id)!;
    j.rotation.z = side * 0.15;
    rest.set(id, j.rotation.clone());
    idleSpinners.push(j);
  }

  for (let i = 0; i < 3; i++) {
    const f = shape(geo.petal(0.22, 0.1), shade(body, -0.15), { outline: 0.06 });
    f.rotation.set(Math.PI / 2, 0, (i - 1) * 0.4);
    f.position.set((i - 1) * 0.05, 0, -0.1);
    joints.get('tail')!.add(f);
  }
  const j = joints.get('tail')!;
  j.rotation.x = 0.6;
  rest.set('tail', j.rotation.clone());

  for (const [lg, ft] of [['leftLeg', 'leftFoot'], ['rightLeg', 'rightFoot']] as const) {
    joints.get(lg)!.add(limbSegment(0.13, 0.026, pal.accent));
    const foot = shape(geo.box(0.07, 0.025, 0.11), pal.accent, { outline: 0.07 });
    at(joints, ft, foot, [0, -0.01, 0.03]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'bird', height: 0.95, idleSpinners };
}

function buildFrog(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.frog;
  const body = p.bodyColor ?? pal.body;
  const { root, joints, rest } = buildSkeleton('biped');
  joints.get('hips')!.position.y = 0.44;

  const torso = shape(geo.sphere(0.3, 20), body);
  torso.scale.set(1.1, 0.92, 1);
  at(joints, 'chest', torso, [0, -0.06, 0]);
  const belly = shape(geo.sphere(0.24, 16), PALETTE.offWhite, { outline: false });
  belly.scale.set(1, 0.85, 0.6);
  at(joints, 'chest', belly, [0, -0.1, 0.16]);

  const headR = 0.28;
  const head = shape(geo.sphere(headR, 20), body);
  head.scale.set(1.15, 0.9, 1);
  at(joints, 'head', head, [0, 0.06, 0]);
  // Frog eyes sit on top of the head, in their own domes.
  const face = buildFace({ headRadius: headR, eyeSize: 0.44, eyeSpacing: 0.5, eyeHeight: 0.62, irisColor: 0x2a2118, brows: false, faceDepth: 0.62 });
  at(joints, 'head', face.group, [0, 0.06, 0]);
  for (const side of [1, -1]) {
    const dome = shape(geo.sphere(headR * 0.4, 14), body, { outline: 0.05 });
    dome.position.set(side * headR * 0.5, headR * 0.68, headR * 0.2);
    joints.get('head')!.add(dome);
  }

  for (const [sh, el, hd, side] of [
    ['leftShoulder', 'leftElbow', 'leftHand', 1], ['rightShoulder', 'rightElbow', 'rightHand', -1],
  ] as const) {
    joints.get(sh)!.add(armSegment(0.2, 0.05, body, side));
    joints.get(el)!.add(armSegment(0.18, 0.045, body, side));
    const hand = shape(geo.sphere(0.075, 12), shade(body, 0.2), { outline: 0.05 });
    hand.scale.set(1.3, 0.7, 1.1);
    at(joints, hd, hand);
    const j = joints.get(sh)!;
    j.rotation.z = -side * 1.1;
    rest.set(sh, j.rotation.clone());
  }
  for (const [hp, kn, ft] of [['leftHip', 'leftKnee', 'leftFoot'], ['rightHip', 'rightKnee', 'rightFoot']] as const) {
    joints.get(hp)!.add(limbSegment(0.26, 0.07, body));
    joints.get(kn)!.add(limbSegment(0.24, 0.055, body));
    const foot = shape(geo.sphere(0.09, 12), shade(body, 0.2), { outline: 0.05 });
    foot.scale.set(1.3, 0.5, 1.6);
    at(joints, ft, foot, [0, -0.02, 0.05]);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'biped', height: 1.15, idleSpinners: [] };
}

function buildCloud(p: CharacterParams): CharacterInstance {
  const body = p.bodyColor ?? PALETTE.white;
  const { root, joints, rest } = buildSkeleton('blob');

  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.34], [0.3, -0.06, 0.02, 0.26], [-0.3, -0.06, -0.02, 0.26],
    [0.15, 0.18, -0.04, 0.24], [-0.16, 0.16, 0.04, 0.22], [0.46, -0.14, 0, 0.18], [-0.46, -0.14, 0, 0.18],
  ];
  for (const [x, y, z, r] of puffs) {
    const m = shape(geo.sphere(r, 16), body, { outline: 0.04 });
    at(joints, 'body', m, [x, y, z]);
  }

  const face = buildFace({ headRadius: 0.34, eyeSize: 0.36, eyeSpacing: 0.4, eyeHeight: 0.1, irisColor: 0x3f5f8a, brows: false, faceDepth: 0.9 });
  at(joints, 'body', face.group);

  for (const [id, side] of [['leftArm', 1], ['rightArm', -1]] as const) {
    const a = shape(geo.sphere(0.14, 12), body, { outline: 0.05 });
    a.scale.set(1.3, 0.8, 0.9);
    joints.get(id)!.add(a);
    const j = joints.get(id)!;
    j.rotation.z = -side * 0.3;
    rest.set(id, j.rotation.clone());
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'blob', height: 1.1, idleSpinners: [] };
}

function buildCaterpillar(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.caterpillar;
  const body = p.bodyColor ?? pal.body;
  const accent = p.accentColor ?? pal.stripe;
  const { root, joints, rest } = buildSkeleton('serpent');

  ['seg1', 'seg2', 'seg3', 'seg4', 'seg5'].forEach((id, i) => {
    const r = 0.2 - i * 0.016;
    const seg = shape(geo.sphere(r, 16), i % 2 === 0 ? body : accent);
    at(joints, id, seg);
    // Little feet under every segment.
    for (const side of [1, -1]) {
      const foot = shape(geo.sphere(0.045, 8), shade(accent, -0.2), { outline: 0.06 });
      at(joints, id, foot, [side * r * 0.6, -r * 0.85, 0]);
    }
  });

  const headR = 0.23;
  at(joints, 'head', shape(geo.sphere(headR, 20), shade(body, 0.15)));
  const face = buildFace({ headRadius: headR, eyeSize: 0.44, eyeSpacing: 0.44, eyeHeight: 0.12, irisColor: 0x2f4a22, brows: false });
  at(joints, 'head', face.group);
  for (const side of [1, -1]) {
    const stalk = shape(geo.capsule(0.016, 0.13, 6), accent, { outline: 0.09 });
    stalk.rotation.z = -side * 0.35;
    stalk.position.set(side * 0.05, headR * 0.85, 0);
    joints.get('head')!.add(stalk);
    const tip = shape(geo.sphere(0.036, 8), PALETTE.petalPink, { outline: 0.08 });
    tip.position.set(side * 0.11, headR * 1.2, 0);
    joints.get('head')!.add(tip);
  }

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'serpent', height: 0.6, idleSpinners: [] };
}

function buildFish(p: CharacterParams): CharacterInstance {
  const pal = CHARACTER_PALETTES.fish;
  const body = p.bodyColor ?? pal.body;
  const { root, joints, rest } = buildSkeleton('fish');

  const torso = shape(geo.sphere(0.24, 20), body);
  torso.scale.set(0.7, 1, 1.3);
  at(joints, 'body', torso);
  ['spine1', 'spine2'].forEach((id, i) => {
    const s = shape(geo.sphere(0.17 - i * 0.05, 14), shade(body, i * 0.08));
    s.scale.set(0.6, 1, 1);
    at(joints, id, s);
  });
  for (let i = 0; i < 3; i++) {
    const f = shape(geo.petal(0.24, 0.13), pal.stripe, { outline: 0.06 });
    f.rotation.set(Math.PI / 2, 0, (i - 1) * 0.55 + Math.PI / 2);
    f.position.set(0, (i - 1) * 0.09, -0.08);
    joints.get('tail')!.add(f);
  }

  const headR = 0.2;
  at(joints, 'head', shape(geo.sphere(headR, 18), shade(body, 0.1)));
  const face = buildFace({ headRadius: headR, eyeSize: 0.48, eyeSpacing: 0.52, eyeHeight: 0.14, irisColor: 0x23303f, brows: false, faceDepth: 0.72 });
  at(joints, 'head', face.group);

  for (const [id, side] of [['leftFin', 1], ['rightFin', -1]] as const) {
    const f = shape(geo.petal(0.2, 0.11), pal.stripe, { outline: 0.06 });
    f.rotation.set(Math.PI / 2, 0, -side * 1.2);
    f.position.set(side * 0.09, 0, 0);
    joints.get(id)!.add(f);
    const j = joints.get(id)!;
    j.rotation.z = side * 0.2;
    rest.set(id, j.rotation.clone());
  }
  const top = shape(geo.petal(0.22, 0.12), pal.stripe, { outline: 0.06 });
  top.rotation.set(0, Math.PI / 2, 0);
  joints.get('topFin')!.add(top);

  root.scale.setScalar(p.scale ?? 1);
  return { root, joints, rest, face, rigFamily: 'fish', height: 0.6, idleSpinners: [] };
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  rigFamily: RigFamily;
  /** Grouping in the asset browser. */
  group: 'stars' | 'friends' | 'kids' | 'animals' | 'nature';
  build: (p: CharacterParams) => CharacterInstance;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'char.buzzy', name: 'Buzzy the Bee', description: 'The show\'s host. Cheerful, curious, wears a flower.', rigFamily: 'winged-bug', group: 'stars', build: (p) => buildBee(p, 'buzzy') },
  { id: 'char.bee', name: 'Bee', description: 'A friendly bee. Same rig as Buzzy, no flower.', rigFamily: 'winged-bug', group: 'friends', build: (p) => buildBee(p, 'plain') },
  { id: 'char.ladybird', name: 'Ladybird', description: 'Spotty, round and bouncy.', rigFamily: 'winged-bug', group: 'friends', build: buildLadybird },
  { id: 'char.butterfly', name: 'Butterfly', description: 'Big patterned wings, floats gracefully.', rigFamily: 'winged-bug', group: 'friends', build: buildButterfly },
  { id: 'char.kid', name: 'Child', description: 'A child. Skin, hair and clothes are all adjustable.', rigFamily: 'biped', group: 'kids', build: (p) => buildHuman(p, 'kid') },
  { id: 'char.adult', name: 'Grown-up', description: 'A teacher or parent. Same controls as the child.', rigFamily: 'biped', group: 'kids', build: (p) => buildHuman(p, 'adult') },
  { id: 'char.puppy', name: 'Puppy', description: 'Floppy ears and a wagging tail.', rigFamily: 'quadruped', group: 'animals', build: (p) => buildQuadruped(p, 'puppy') },
  { id: 'char.kitten', name: 'Kitten', description: 'Pointy ears, curly tail.', rigFamily: 'quadruped', group: 'animals', build: (p) => buildQuadruped(p, 'kitten') },
  { id: 'char.bunny', name: 'Bunny', description: 'Long ears and a fluffy tail. Hops beautifully.', rigFamily: 'quadruped', group: 'animals', build: (p) => buildQuadruped(p, 'bunny') },
  { id: 'char.bird', name: 'Little bird', description: 'Hops, flaps and sings.', rigFamily: 'bird', group: 'animals', build: buildBird },
  { id: 'char.frog', name: 'Frog', description: 'Big eyes on top, brilliant jumper.', rigFamily: 'biped', group: 'animals', build: buildFrog },
  { id: 'char.cloud', name: 'Cloud friend', description: 'A smiling cloud. Wobbles instead of walking.', rigFamily: 'blob', group: 'nature', build: buildCloud },
  { id: 'char.caterpillar', name: 'Caterpillar', description: 'A rippling chain of segments.', rigFamily: 'serpent', group: 'friends', build: buildCaterpillar },
  { id: 'char.fish', name: 'Fish', description: 'For pond and under-water scenes.', rigFamily: 'fish', group: 'animals', build: buildFish },
];

export const CHARACTER_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export function buildCharacter(assetId: string, params: CharacterParams = {}): CharacterInstance | null {
  const def = CHARACTER_BY_ID.get(assetId);
  if (!def) return null;
  const inst = def.build(params);
  inst.root.name = def.name;
  return inst;
}
