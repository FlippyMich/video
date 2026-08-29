/**
 * The prop library.
 *
 * Same idea as the characters: built from primitives, no downloads. Props are
 * static by default but every one returns a plain `Object3D`, so the animation
 * evaluator can move, spin and squash them like anything else.
 */

import * as THREE from 'three';
import { PALETTE, pick, shade } from './palette';
import { flat, geo, outline, shape, toon } from './materials';

export interface PropParams {
  color?: number;
  accent?: number;
  seed?: number;
  scale?: number;
  text?: string;
}

type Builder = (p: PropParams) => THREE.Object3D;

const rnd = (seed: number) => {
  let s = (seed || 1) * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};

/* ------------------------------------------------------------------ *
 * Plants
 * ------------------------------------------------------------------ */

function flower(petalColor: number, centreColor: number, petals: number, height: number, petalLen = 0.22): THREE.Group {
  const g = new THREE.Group();
  const stem = shape(geo.cylinder(0.025, 0.032, height, 8), PALETTE.stem, { outline: 0.05 });
  stem.position.y = height / 2;
  g.add(stem);
  for (let i = 0; i < 2; i++) {
    const leaf = shape(geo.petal(0.2, 0.11), PALETTE.leaf, { outline: 0.05 });
    leaf.position.set(0, height * (0.32 + i * 0.24), 0);
    leaf.rotation.set(0.2, 0, i === 0 ? 1.1 : -1.1);
    g.add(leaf);
  }
  const headGroup = new THREE.Group();
  headGroup.position.y = height;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const petal = shape(geo.petal(petalLen, petalLen * 0.55), petalColor, { outline: 0.05 });
    petal.position.set(Math.cos(a) * petalLen * 0.55, Math.sin(a) * petalLen * 0.55, -0.01);
    petal.rotation.set(0, 0, a - Math.PI / 2);
    headGroup.add(petal);
  }
  const centre = shape(geo.sphere(petalLen * 0.4, 14), centreColor, { outline: 0.05 });
  centre.scale.z = 0.6;
  headGroup.add(centre);
  headGroup.rotation.x = -0.25;
  g.add(headGroup);
  g.userData.head = headGroup;
  return g;
}

const BUILDERS: Record<string, Builder> = {
  'prop.flower': (p) => {
    const r = rnd(p.seed ?? 1);
    const colors = [PALETTE.petalPink, PALETTE.petalPurple, PALETTE.lemon, PALETTE.white, PALETTE.orange];
    return flower(p.color ?? pick(colors, (p.seed ?? 1) * 3), p.accent ?? PALETTE.honeyDeep, 6, 0.5 + r() * 0.3);
  },
  'prop.daisy': (p) => flower(p.color ?? PALETTE.white, p.accent ?? PALETTE.lemon, 8, 0.42, 0.19),
  'prop.tulip': (p) => {
    const g = new THREE.Group();
    const h = 0.62;
    const stem = shape(geo.cylinder(0.026, 0.03, h, 8), PALETTE.stem, { outline: 0.05 });
    stem.position.y = h / 2;
    g.add(stem);
    const cup = shape(geo.sphere(0.14, 14), p.color ?? PALETTE.strawberry);
    cup.scale.set(1, 1.35, 1);
    cup.position.y = h + 0.1;
    g.add(cup);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const petal = shape(geo.petal(0.24, 0.12), p.color ?? PALETTE.strawberry, { outline: 0.05 });
      petal.position.set(Math.cos(a) * 0.09, h + 0.14, Math.sin(a) * 0.09);
      petal.rotation.set(0.35, -a, 0);
      g.add(petal);
    }
    for (const side of [1, -1]) {
      const leaf = shape(geo.petal(0.34, 0.11), PALETTE.leaf, { outline: 0.05 });
      leaf.position.set(side * 0.06, h * 0.42, 0);
      leaf.rotation.set(0.2, 0, side * 0.5);
      g.add(leaf);
    }
    return g;
  },
  'prop.sunflower': (p) => {
    const g = flower(p.color ?? PALETTE.lemon, p.accent ?? PALETTE.soilDeep, 12, 1.15, 0.3);
    g.scale.setScalar(1.15);
    return g;
  },
  'prop.grass-tuft': (p) => {
    const g = new THREE.Group();
    const r = rnd(p.seed ?? 2);
    for (let i = 0; i < 5; i++) {
      const h = 0.16 + r() * 0.18;
      const blade = shape(geo.capsule(0.018, h, 5), shade(p.color ?? PALETTE.leaf, (r() - 0.5) * 0.3), { outline: 0.07 });
      blade.position.set((r() - 0.5) * 0.16, h / 2, (r() - 0.5) * 0.16);
      blade.rotation.z = (r() - 0.5) * 0.7;
      g.add(blade);
    }
    return g;
  },
  'prop.bush': (p) => {
    const g = new THREE.Group();
    const r = rnd(p.seed ?? 3);
    const c = p.color ?? PALETTE.leaf;
    for (let i = 0; i < 5; i++) {
      const rad = 0.2 + r() * 0.16;
      const m = shape(geo.sphere(rad, 14), shade(c, (r() - 0.5) * 0.22), { outline: 0.04 });
      m.position.set((r() - 0.5) * 0.44, rad * 0.85, (r() - 0.5) * 0.4);
      g.add(m);
    }
    return g;
  },
  'prop.tree': (p) => {
    const g = new THREE.Group();
    const r = rnd(p.seed ?? 4);
    const h = 1.5 + r() * 0.9;
    const trunk = shape(geo.cylinder(0.13, 0.2, h, 10), PALETTE.bark);
    trunk.position.y = h / 2;
    g.add(trunk);
    const crownColor = p.color ?? PALETTE.leafDeep;
    for (let i = 0; i < 4; i++) {
      const rad = 0.5 + r() * 0.32;
      const m = shape(geo.sphere(rad, 16), shade(crownColor, (r() - 0.4) * 0.3), { outline: 0.03 });
      m.position.set((r() - 0.5) * 0.7, h + (r() - 0.2) * 0.45, (r() - 0.5) * 0.7);
      g.add(m);
    }
    return g;
  },
  'prop.blossom-tree': (p) => {
    const g = BUILDERS['prop.tree']({ ...p, color: PALETTE.leafLight }) as THREE.Group;
    const r = rnd((p.seed ?? 4) + 11);
    for (let i = 0; i < 14; i++) {
      const b = shape(geo.sphere(0.09, 8), PALETTE.petalBlush, { outline: 0.06 });
      const a = r() * Math.PI * 2;
      const rad = 0.5 + r() * 0.5;
      b.position.set(Math.cos(a) * rad, 1.7 + (r() - 0.4) * 0.7, Math.sin(a) * rad);
      g.add(b);
    }
    return g;
  },
  'prop.mushroom': (p) => {
    const g = new THREE.Group();
    const stalk = shape(geo.cylinder(0.07, 0.09, 0.22, 10), PALETTE.offWhite);
    stalk.position.y = 0.11;
    g.add(stalk);
    const cap = shape(geo.sphere(0.19, 16), p.color ?? PALETTE.strawberry);
    cap.scale.y = 0.62;
    cap.position.y = 0.24;
    g.add(cap);
    const r = rnd(p.seed ?? 5);
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      const dot = new THREE.Mesh(geo.circle(0.035, 8), flat(PALETTE.white));
      const rad = r() * 0.13;
      dot.position.set(Math.cos(a) * rad, 0.24 + Math.sqrt(Math.max(0, 0.036 - rad * rad * 0.9)) * 0.9, Math.sin(a) * rad);
      dot.rotation.x = -Math.PI / 2;
      g.add(dot);
    }
    return g;
  },
  'prop.lilypad': (p) => {
    const g = new THREE.Group();
    const pad = shape(geo.circle(0.42, 20), p.color ?? PALETTE.leaf, { outline: false });
    pad.rotation.x = -Math.PI / 2;
    g.add(pad);
    const notch = new THREE.Mesh(geo.circle(0.12, 12), flat(PALETTE.waterDeep));
    notch.rotation.x = -Math.PI / 2;
    notch.position.set(0.3, 0.002, 0);
    g.add(notch);
    return g;
  },

  /* ---------------------------------------------------------------- *
   * Natural objects
   * ---------------------------------------------------------------- */
  'prop.rock': (p) => {
    const r = rnd(p.seed ?? 6);
    const m = shape(geo.sphere(0.3, 10), p.color ?? 0x9aa2ac);
    m.scale.set(1 + r() * 0.4, 0.62 + r() * 0.3, 0.9 + r() * 0.35);
    m.rotation.y = r() * 3;
    m.position.y = 0.16;
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  'prop.log': (p) => {
    const g = new THREE.Group();
    const log = shape(geo.cylinder(0.19, 0.19, 1.1, 12), p.color ?? PALETTE.bark);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.19;
    g.add(log);
    for (const side of [1, -1]) {
      const ring = new THREE.Mesh(geo.circle(0.17, 12), flat(shade(PALETTE.bark, 0.3)));
      ring.rotation.y = (side * Math.PI) / 2;
      ring.position.set(side * 0.552, 0.19, 0);
      g.add(ring);
    }
    return g;
  },
  'prop.pinecone': (p) => {
    const g = new THREE.Group();
    const core = shape(geo.sphere(0.13, 12), p.color ?? PALETTE.barkDeep);
    core.scale.set(1, 1.5, 1);
    core.position.y = 0.19;
    g.add(core);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 * 2.4;
      const y = 0.06 + (i / 16) * 0.28;
      const scale = 1 - Math.abs(i / 16 - 0.45) * 0.8;
      const sc = new THREE.Mesh(geo.cone(0.055 * scale, 0.08, 5), toon(shade(PALETTE.barkDeep, 0.18)));
      sc.position.set(Math.cos(a) * 0.11 * scale, y, Math.sin(a) * 0.11 * scale);
      sc.rotation.set(Math.PI / 2 - 0.5, 0, -a + Math.PI / 2);
      g.add(sc);
    }
    return g;
  },
  'prop.feather': (p) => {
    const g = new THREE.Group();
    const quill = shape(geo.capsule(0.012, 0.34, 6), PALETTE.offWhite, { outline: 0.1 });
    quill.position.y = 0.2;
    g.add(quill);
    const vane = shape(geo.petal(0.34, 0.13), p.color ?? PALETTE.sky, { outline: 0.06 });
    vane.position.y = 0.24;
    g.add(vane);
    return g;
  },
  'prop.moss-patch': (p) => {
    const g = new THREE.Group();
    const r = rnd(p.seed ?? 7);
    for (let i = 0; i < 12; i++) {
      const rad = 0.07 + r() * 0.07;
      const m = shape(geo.sphere(rad, 8), shade(p.color ?? PALETTE.moss, (r() - 0.4) * 0.35), { outline: 0.05 });
      m.scale.y = 0.6;
      m.position.set((r() - 0.5) * 0.7, rad * 0.5, (r() - 0.5) * 0.7);
      g.add(m);
    }
    return g;
  },
  'prop.rainbow': (p) => {
    const g = new THREE.Group();
    const bands = [0xff5b5b, PALETTE.orange, PALETTE.lemon, PALETTE.leaf, PALETTE.skyDeep, PALETTE.petalPurple];
    bands.forEach((c, i) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(2.6 - i * 0.24, 0.13, 8, 48, Math.PI),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }),
      );
      g.add(arc);
    });
    g.scale.setScalar(p.scale ?? 1);
    return g;
  },
  'prop.sun': () => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(geo.sphere(0.6, 20), flat(PALETTE.lemon));
    g.add(core);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ray = new THREE.Mesh(geo.capsule(0.055, 0.3, 6), flat(PALETTE.honey));
      ray.position.set(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0);
      ray.rotation.z = a - Math.PI / 2;
      g.add(ray);
    }
    return g;
  },
  'prop.cloud': (p) => {
    const g = new THREE.Group();
    const r = rnd(p.seed ?? 8);
    for (let i = 0; i < 5; i++) {
      const rad = 0.3 + r() * 0.3;
      const m = new THREE.Mesh(geo.sphere(rad, 14), flat(p.color ?? PALETTE.white));
      m.position.set((i - 2) * 0.36, (r() - 0.5) * 0.16, (r() - 0.5) * 0.2);
      g.add(m);
    }
    return g;
  },

  /* ---------------------------------------------------------------- *
   * Food — the taste scenes need these
   * ---------------------------------------------------------------- */
  'prop.strawberry': () => {
    const g = new THREE.Group();
    const body = shape(geo.sphere(0.16, 16), PALETTE.strawberry);
    body.scale.set(1, 1.2, 1);
    body.position.y = 0.16;
    g.add(body);
    const tip = shape(geo.cone(0.1, 0.12, 10), PALETTE.strawberry, { outline: 0.05 });
    tip.rotation.x = Math.PI;
    tip.position.y = 0.02;
    g.add(tip);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leaf = shape(geo.petal(0.11, 0.055), PALETTE.leaf, { outline: 0.07 });
      leaf.position.set(Math.cos(a) * 0.07, 0.32, Math.sin(a) * 0.07);
      leaf.rotation.set(1.2, -a, 0);
      g.add(leaf);
    }
    return g;
  },
  'prop.lemon': () => {
    const g = new THREE.Group();
    const body = shape(geo.sphere(0.17, 16), PALETTE.lemon);
    body.scale.set(1, 1.25, 1);
    body.position.y = 0.19;
    g.add(body);
    for (const s of [1, -1]) {
      const nub = shape(geo.sphere(0.05, 8), PALETTE.lemon, { outline: 0.06 });
      nub.position.y = 0.19 + s * 0.21;
      g.add(nub);
    }
    return g;
  },
  'prop.apple': (p) => {
    const g = new THREE.Group();
    const body = shape(geo.sphere(0.19, 18), p.color ?? 0xe8404a);
    body.scale.set(1, 0.94, 1);
    body.position.y = 0.19;
    g.add(body);
    const stalk = shape(geo.capsule(0.016, 0.1, 5), PALETTE.barkDeep, { outline: 0.1 });
    stalk.position.y = 0.4;
    g.add(stalk);
    const leaf = shape(geo.petal(0.14, 0.07), PALETTE.leaf, { outline: 0.06 });
    leaf.position.set(0.07, 0.44, 0);
    leaf.rotation.set(0.4, 0, -0.9);
    g.add(leaf);
    return g;
  },
  'prop.honeypot': () => {
    const g = new THREE.Group();
    const pot = shape(geo.cylinder(0.19, 0.15, 0.3, 14), 0xd9a05b);
    pot.position.y = 0.15;
    g.add(pot);
    const rim = shape(geo.torus(0.2, 0.035, 16), shade(0xd9a05b, -0.2), { outline: 0.05 });
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.3;
    g.add(rim);
    const honey = new THREE.Mesh(geo.circle(0.185, 16), flat(PALETTE.honeyDeep));
    honey.rotation.x = -Math.PI / 2;
    honey.position.y = 0.295;
    g.add(honey);
    return g;
  },
  'prop.cupcake': (p) => {
    const g = new THREE.Group();
    const base = shape(geo.cylinder(0.15, 0.11, 0.16, 14), p.accent ?? PALETTE.petalBlush);
    base.position.y = 0.08;
    g.add(base);
    const icing = shape(geo.sphere(0.16, 16), p.color ?? PALETTE.petalPink);
    icing.scale.y = 0.85;
    icing.position.y = 0.22;
    g.add(icing);
    const cherry = shape(geo.sphere(0.055, 10), PALETTE.strawberry, { outline: 0.06 });
    cherry.position.y = 0.36;
    g.add(cherry);
    return g;
  },
  'prop.basket': () => {
    const g = new THREE.Group();
    const body = shape(geo.cylinder(0.3, 0.24, 0.26, 16), 0xc79a5f);
    body.position.y = 0.13;
    g.add(body);
    const handle = shape(geo.torus(0.26, 0.028, 18), 0xa87f48, { outline: 0.06 });
    handle.position.y = 0.26;
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    return g;
  },

  /* ---------------------------------------------------------------- *
   * Sound-makers
   * ---------------------------------------------------------------- */
  'prop.bell': (p) => {
    const g = new THREE.Group();
    const body = shape(geo.cone(0.19, 0.28, 16), p.color ?? PALETTE.honey);
    body.position.y = 0.2;
    g.add(body);
    const dome = shape(geo.sphere(0.115, 12), p.color ?? PALETTE.honey, { outline: 0.05 });
    dome.position.y = 0.33;
    g.add(dome);
    const ring = shape(geo.torus(0.05, 0.018, 12), shade(PALETTE.honey, -0.3), { outline: 0.07 });
    ring.position.y = 0.45;
    g.add(ring);
    const clapper = shape(geo.sphere(0.06, 10), PALETTE.charcoal, { outline: 0.06 });
    clapper.position.y = 0.05;
    g.add(clapper);
    return g;
  },
  'prop.drum': (p) => {
    const g = new THREE.Group();
    const body = shape(geo.cylinder(0.28, 0.28, 0.24, 18), p.color ?? PALETTE.strawberry);
    body.position.y = 0.12;
    g.add(body);
    const skin = new THREE.Mesh(geo.circle(0.28, 18), flat(PALETTE.offWhite));
    skin.rotation.x = -Math.PI / 2;
    skin.position.y = 0.242;
    g.add(skin);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lace = shape(geo.capsule(0.014, 0.2, 5), PALETTE.honey, { outline: 0.09 });
      lace.position.set(Math.cos(a) * 0.285, 0.12, Math.sin(a) * 0.285);
      lace.rotation.z = 0.2;
      g.add(lace);
    }
    return g;
  },
  'prop.wind-chime': () => {
    const g = new THREE.Group();
    const top = shape(geo.cylinder(0.16, 0.16, 0.04, 14), PALETTE.bark);
    top.position.y = 1.2;
    g.add(top);
    const colors = [PALETTE.petalPink, PALETTE.sky, PALETTE.lemon, PALETTE.leaf, PALETTE.petalPurple];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const len = 0.3 + (i % 3) * 0.08;
      const tube = shape(geo.cylinder(0.028, 0.028, len, 10), colors[i], { outline: 0.05 });
      tube.position.set(Math.cos(a) * 0.11, 1.18 - len / 2 - 0.06, Math.sin(a) * 0.11);
      g.add(tube);
    }
    return g;
  },
  'prop.speaker': () => {
    const g = new THREE.Group();
    const box = shape(geo.box(0.34, 0.5, 0.28), PALETTE.charcoal);
    box.position.y = 0.25;
    g.add(box);
    for (const [y, r] of [[0.34, 0.09], [0.15, 0.12]] as const) {
      const cone = shape(geo.circle(r, 16), 0x6b6270, { outline: false });
      cone.position.set(0, y, 0.142);
      g.add(cone);
    }
    return g;
  },

  /* ---------------------------------------------------------------- *
   * Classroom & indoor
   * ---------------------------------------------------------------- */
  'prop.desk': (p) => {
    const g = new THREE.Group();
    const top = shape(geo.box(1.1, 0.07, 0.6), p.color ?? PALETTE.wood);
    top.position.y = 0.62;
    g.add(top);
    for (const [x, z] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]] as const) {
      const leg = shape(geo.cylinder(0.035, 0.035, 0.6, 8), PALETTE.woodDeep, { outline: 0.06 });
      leg.position.set(x, 0.3, z);
      g.add(leg);
    }
    return g;
  },
  'prop.chair': (p) => {
    const g = new THREE.Group();
    const seat = shape(geo.box(0.42, 0.06, 0.42), p.color ?? PALETTE.plastic);
    seat.position.y = 0.4;
    g.add(seat);
    const back = shape(geo.box(0.42, 0.4, 0.06), p.color ?? PALETTE.plastic);
    back.position.set(0, 0.6, -0.18);
    g.add(back);
    for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) {
      const leg = shape(geo.cylinder(0.024, 0.024, 0.4, 8), 0x8a8f99, { outline: 0.07 });
      leg.position.set(x, 0.2, z);
      g.add(leg);
    }
    return g;
  },
  'prop.chalkboard': (p) => {
    const g = new THREE.Group();
    const frame = shape(geo.box(2.5, 1.5, 0.1), PALETTE.woodDeep);
    frame.position.y = 1.5;
    g.add(frame);
    const board = new THREE.Mesh(geo.plane(2.3, 1.3), flat(p.color ?? PALETTE.chalkboard));
    board.position.set(0, 1.5, 0.052);
    g.add(board);
    const tray = shape(geo.box(2.5, 0.07, 0.16), PALETTE.woodDeep);
    tray.position.set(0, 0.74, 0.08);
    g.add(tray);
    return g;
  },
  'prop.book': (p) => {
    const g = new THREE.Group();
    const cover = shape(geo.box(0.34, 0.05, 0.44), p.color ?? PALETTE.skyDeep);
    cover.position.y = 0.025;
    g.add(cover);
    const pages = shape(geo.box(0.31, 0.04, 0.41), PALETTE.paper, { outline: false });
    pages.position.y = 0.032;
    g.add(pages);
    return g;
  },
  'prop.ball': (p) => {
    const g = new THREE.Group();
    const ball = shape(geo.sphere(0.24, 20), p.color ?? PALETTE.strawberry);
    ball.position.y = 0.24;
    g.add(ball);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(geo.torus(0.242, 0.03, 20), toon(p.accent ?? PALETTE.white));
      band.rotation.x = Math.PI / 2;
      band.rotation.y = (i / 3) * Math.PI;
      band.position.y = 0.24;
      g.add(band);
    }
    return g;
  },
  'prop.magnifier': (p) => {
    const g = new THREE.Group();
    const rim = shape(geo.torus(0.24, 0.035, 22), p.color ?? PALETTE.honeyDeep, { outline: 0.05 });
    rim.position.y = 0.7;
    g.add(rim);
    const lens = new THREE.Mesh(geo.circle(0.235, 22), new THREE.MeshBasicMaterial({ color: 0xd9f2ff, transparent: true, opacity: 0.45 }));
    lens.position.y = 0.7;
    g.add(lens);
    const handle = shape(geo.capsule(0.045, 0.36, 10), PALETTE.bark, { outline: 0.05 });
    handle.position.y = 0.24;
    g.add(handle);
    return g;
  },
  'prop.watering-can': (p) => {
    const g = new THREE.Group();
    const body = shape(geo.cylinder(0.2, 0.22, 0.34, 14), p.color ?? PALETTE.plastic);
    body.position.y = 0.17;
    g.add(body);
    const spout = shape(geo.cylinder(0.05, 0.08, 0.42, 10), p.color ?? PALETTE.plastic);
    spout.position.set(0.24, 0.3, 0);
    spout.rotation.z = -0.9;
    g.add(spout);
    const handle = shape(geo.torus(0.11, 0.028, 14), shade(PALETTE.plastic, -0.2), { outline: 0.06 });
    handle.position.set(-0.15, 0.36, 0);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);
    return g;
  },
  'prop.signpost': (p) => {
    const g = new THREE.Group();
    const post = shape(geo.cylinder(0.045, 0.05, 1.3, 8), PALETTE.bark);
    post.position.y = 0.65;
    g.add(post);
    const board = shape(geo.box(0.8, 0.28, 0.05), p.color ?? PALETTE.honey);
    board.position.set(0.15, 1.15, 0.02);
    board.rotation.z = -0.06;
    g.add(board);
    return g;
  },
  'prop.fence': (p) => {
    const g = new THREE.Group();
    const c = p.color ?? PALETTE.offWhite;
    for (let i = 0; i < 4; i++) {
      const post = shape(geo.box(0.09, 0.7, 0.07), c);
      post.position.set(i * 0.42 - 0.63, 0.35, 0);
      g.add(post);
      const cap = shape(geo.cone(0.07, 0.1, 4), c, { outline: 0.06 });
      cap.position.set(i * 0.42 - 0.63, 0.75, 0);
      g.add(cap);
    }
    for (const y of [0.28, 0.55]) {
      const rail = shape(geo.box(1.72, 0.07, 0.05), c);
      rail.position.set(-0.21, y, 0.02);
      g.add(rail);
    }
    return g;
  },
  'prop.birdhouse': (p) => {
    const g = new THREE.Group();
    const post = shape(geo.cylinder(0.05, 0.055, 1.4, 8), PALETTE.bark);
    post.position.y = 0.7;
    g.add(post);
    const box = shape(geo.box(0.36, 0.34, 0.32), p.color ?? PALETTE.petalPink);
    box.position.y = 1.55;
    g.add(box);
    const roofL = shape(geo.box(0.3, 0.05, 0.36), PALETTE.strawberry);
    roofL.position.set(-0.11, 1.79, 0);
    roofL.rotation.z = 0.6;
    g.add(roofL);
    const roofR = roofL.clone();
    roofR.position.x = 0.11;
    roofR.rotation.z = -0.6;
    g.add(roofR);
    const hole = new THREE.Mesh(geo.circle(0.08, 14), flat(PALETTE.charcoal));
    hole.position.set(0, 1.58, 0.162);
    g.add(hole);
    return g;
  },
  'prop.picnic-blanket': (p) => {
    const g = new THREE.Group();
    const size = 2.2;
    const base = new THREE.Mesh(geo.plane(size, size), flat(p.color ?? PALETTE.strawberry));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.01;
    g.add(base);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 2) continue;
        const sq = new THREE.Mesh(geo.plane(size / 4, size / 4), flat(PALETTE.white));
        sq.rotation.x = -Math.PI / 2;
        sq.position.set((i - 1.5) * (size / 4), 0.015, (j - 1.5) * (size / 4));
        g.add(sq);
      }
    }
    return g;
  },

  /* ---------------------------------------------------------------- *
   * Graphic elements — these carry the "kids TV" feel
   * ---------------------------------------------------------------- */
  'prop.star': (p) => {
    const m = shape(geo.star(0.3), p.color ?? PALETTE.lemon, { outline: 0.06 });
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  'prop.heart': (p) => {
    const g = new THREE.Group();
    const c = p.color ?? PALETTE.petalRose;
    for (const side of [1, -1]) {
      const lobe = shape(geo.sphere(0.16, 14), c, { outline: 0.05 });
      lobe.position.set(side * 0.11, 0.12, 0);
      lobe.scale.z = 0.6;
      g.add(lobe);
    }
    const point = shape(geo.cone(0.21, 0.3, 12), c, { outline: 0.05 });
    point.rotation.x = Math.PI;
    point.position.y = -0.1;
    point.scale.z = 0.6;
    g.add(point);
    return g;
  },
  'prop.question-mark': (p) => {
    const g = new THREE.Group();
    const c = p.color ?? PALETTE.petalPurple;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 8, 20, Math.PI * 1.35), toon(c));
    hook.position.y = 0.3;
    hook.rotation.z = -0.6;
    outline(hook, 0.05);
    g.add(hook);
    const stem = shape(geo.capsule(0.06, 0.08, 8), c, { outline: 0.05 });
    stem.position.y = 0.07;
    g.add(stem);
    const dot = shape(geo.sphere(0.07, 10), c, { outline: 0.05 });
    dot.position.y = -0.12;
    g.add(dot);
    return g;
  },
  'prop.musical-note': (p) => {
    const g = new THREE.Group();
    const c = p.color ?? PALETTE.petalPurple;
    const head = shape(geo.sphere(0.11, 12), c, { outline: 0.05 });
    head.scale.set(1.2, 0.85, 0.7);
    head.rotation.z = -0.4;
    g.add(head);
    const stem = shape(geo.box(0.035, 0.42, 0.035), c);
    stem.position.set(0.11, 0.22, 0);
    g.add(stem);
    const flag = shape(geo.petal(0.2, 0.08), c, { outline: 0.06 });
    flag.position.set(0.18, 0.38, 0);
    flag.rotation.z = -0.5;
    g.add(flag);
    return g;
  },
  'prop.sparkle': (p) => {
    const g = new THREE.Group();
    const c = p.color ?? PALETTE.butter;
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(geo.cone(0.05, 0.28, 4), flat(c));
      spike.rotation.z = (i / 4) * Math.PI * 2;
      spike.position.set(Math.sin((i / 4) * Math.PI * 2) * -0.14, Math.cos((i / 4) * Math.PI * 2) * 0.14, 0);
      g.add(spike);
    }
    const core = new THREE.Mesh(geo.sphere(0.07, 10), flat(PALETTE.white));
    g.add(core);
    return g;
  },
  'prop.balloon': (p) => {
    const g = new THREE.Group();
    const b = shape(geo.sphere(0.3, 18), p.color ?? PALETTE.strawberry);
    b.scale.set(1, 1.22, 1);
    b.position.y = 1.6;
    g.add(b);
    const knot = shape(geo.cone(0.06, 0.1, 6), p.color ?? PALETTE.strawberry, { outline: 0.07 });
    knot.rotation.x = Math.PI;
    knot.position.y = 1.26;
    g.add(knot);
    const string = shape(geo.cylinder(0.007, 0.007, 1.2, 5), PALETTE.offWhite, { outline: false });
    string.position.y = 0.62;
    g.add(string);
    return g;
  },
};

export interface PropDef {
  id: string;
  name: string;
  group: 'plants' | 'nature' | 'food' | 'sound' | 'indoor' | 'graphics';
  description: string;
}

export const PROPS: PropDef[] = [
  { id: 'prop.flower', name: 'Flower', group: 'plants', description: 'A simple six-petal bloom. Colour is random unless you set it.' },
  { id: 'prop.daisy', name: 'Daisy', group: 'plants', description: 'White petals, yellow middle.' },
  { id: 'prop.tulip', name: 'Tulip', group: 'plants', description: 'Cup-shaped, tall and tidy.' },
  { id: 'prop.sunflower', name: 'Sunflower', group: 'plants', description: 'Big and cheerful. Good for scale.' },
  { id: 'prop.grass-tuft', name: 'Grass tuft', group: 'plants', description: 'Scatter these to fill a lawn.' },
  { id: 'prop.bush', name: 'Bush', group: 'plants', description: 'A rounded shrub.' },
  { id: 'prop.tree', name: 'Tree', group: 'plants', description: 'A leafy tree. Every seed gives a different shape.' },
  { id: 'prop.blossom-tree', name: 'Blossom tree', group: 'plants', description: 'Spring tree covered in pink blossom.' },
  { id: 'prop.mushroom', name: 'Mushroom', group: 'plants', description: 'Spotted toadstool.' },
  { id: 'prop.lilypad', name: 'Lily pad', group: 'plants', description: 'Floats on pond water.' },
  { id: 'prop.rock', name: 'Rock', group: 'nature', description: 'A smooth boulder.' },
  { id: 'prop.log', name: 'Fallen log', group: 'nature', description: 'Good for sitting on.' },
  { id: 'prop.pinecone', name: 'Pinecone', group: 'nature', description: 'Bumpy and prickly — perfect for touch scenes.' },
  { id: 'prop.feather', name: 'Feather', group: 'nature', description: 'Soft and tickly.' },
  { id: 'prop.moss-patch', name: 'Moss patch', group: 'nature', description: 'Squishy green cushion.' },
  { id: 'prop.rainbow', name: 'Rainbow', group: 'nature', description: 'Six-band arc. Scale it up to fill the sky.' },
  { id: 'prop.sun', name: 'Sun', group: 'nature', description: 'Smiling-sun style disc with rays.' },
  { id: 'prop.cloud', name: 'Cloud', group: 'nature', description: 'A plain puffy cloud (no face).' },
  { id: 'prop.strawberry', name: 'Strawberry', group: 'food', description: 'Sweet. The taste-scene favourite.' },
  { id: 'prop.lemon', name: 'Lemon', group: 'food', description: 'Sour! Great for a big reaction.' },
  { id: 'prop.apple', name: 'Apple', group: 'food', description: 'Crunchy.' },
  { id: 'prop.honeypot', name: 'Honey pot', group: 'food', description: 'A bee\'s favourite thing.' },
  { id: 'prop.cupcake', name: 'Cupcake', group: 'food', description: 'Party food.' },
  { id: 'prop.basket', name: 'Basket', group: 'food', description: 'Woven picnic basket.' },
  { id: 'prop.bell', name: 'Bell', group: 'sound', description: 'Ring it! Pairs with the bell sound effect.' },
  { id: 'prop.drum', name: 'Drum', group: 'sound', description: 'Boom boom. Good for keeping a beat.' },
  { id: 'prop.wind-chime', name: 'Wind chime', group: 'sound', description: 'Tinkles in the breeze.' },
  { id: 'prop.speaker', name: 'Speaker', group: 'sound', description: 'For music scenes.' },
  { id: 'prop.desk', name: 'Desk', group: 'indoor', description: 'Classroom table.' },
  { id: 'prop.chair', name: 'Chair', group: 'indoor', description: 'Little plastic school chair.' },
  { id: 'prop.chalkboard', name: 'Chalkboard', group: 'indoor', description: 'The front of the classroom.' },
  { id: 'prop.book', name: 'Book', group: 'indoor', description: 'A closed picture book.' },
  { id: 'prop.ball', name: 'Ball', group: 'indoor', description: 'Beach-ball stripes.' },
  { id: 'prop.magnifier', name: 'Magnifying glass', group: 'indoor', description: 'For looking closely — the "sight" prop.' },
  { id: 'prop.watering-can', name: 'Watering can', group: 'indoor', description: 'Garden tool.' },
  { id: 'prop.signpost', name: 'Signpost', group: 'indoor', description: 'Wooden sign. Add text with a Text node.' },
  { id: 'prop.fence', name: 'Fence', group: 'indoor', description: 'Picket fence section. Repeat it along a line.' },
  { id: 'prop.birdhouse', name: 'Bird house', group: 'indoor', description: 'On a tall post.' },
  { id: 'prop.picnic-blanket', name: 'Picnic blanket', group: 'indoor', description: 'Checked, lies flat on the ground.' },
  { id: 'prop.star', name: 'Star', group: 'graphics', description: 'Chunky five-point star.' },
  { id: 'prop.heart', name: 'Heart', group: 'graphics', description: 'For "I love it!" moments.' },
  { id: 'prop.question-mark', name: 'Question mark', group: 'graphics', description: 'Pops up when Buzzy asks the audience something.' },
  { id: 'prop.musical-note', name: 'Musical note', group: 'graphics', description: 'Floats up during songs.' },
  { id: 'prop.sparkle', name: 'Sparkle', group: 'graphics', description: 'Four-point twinkle.' },
  { id: 'prop.balloon', name: 'Balloon', group: 'graphics', description: 'On a string.' },
];

export const PROP_BY_ID = new Map(PROPS.map((p) => [p.id, p]));

export function buildProp(assetId: string, params: PropParams = {}): THREE.Object3D | null {
  const b = BUILDERS[assetId];
  if (!b) return null;
  const obj = b(params);
  if (params.scale && !['prop.rainbow'].includes(assetId)) obj.scale.setScalar(params.scale);
  obj.name = PROP_BY_ID.get(assetId)?.name ?? assetId;
  return obj;
}
