/**
 * Procedural environments.
 *
 * Pick a theme, pick a seed, get a complete set: ground, backdrop, scatter and
 * a matching sky colour. Two people who type the same seed get the same garden,
 * which is what makes "regenerate until you like it" a safe button to press.
 *
 * Generation is pure and synchronous — no I/O — so the headless renderer builds
 * the identical set the editor previewed.
 */

import * as THREE from 'three';
import type { EnvironmentSpec, EnvironmentTheme } from '../types';
import { PALETTE, shade } from './palette';
import { flat, geo, shape, toon } from './materials';
import { buildProp } from './props';

export interface BuiltEnvironment {
  root: THREE.Group;
  /** Background colour the renderer clears to. */
  background: THREE.Color;
  /** Distance fog, or null for indoor sets. */
  fog: THREE.Fog | null;
  /** Where the key light should come from, in world space. */
  sunDirection: THREE.Vector3;
  sunColor: number;
  ambientColor: number;
  ambientIntensity: number;
  /** Ground height at the origin — characters stand on this. */
  groundY: number;
}

function mulberry(seed: number) {
  let a = (seed || 1) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIME_OF_DAY: Record<string, { sky: number; sun: number; ambient: number; ambientI: number; dir: [number, number, number] }> = {
  morning: { sky: 0xbfe9ff, sun: 0xfff0d0, ambient: 0xa8d8ff, ambientI: 0.72, dir: [-4, 6, 5] },
  noon: { sky: 0x9fdcff, sun: 0xffffff, ambient: 0xcfe9ff, ambientI: 0.8, dir: [2, 9, 4] },
  afternoon: { sky: 0xa8e0ff, sun: 0xfff3d8, ambient: 0xc4e4ff, ambientI: 0.75, dir: [5, 6, 3] },
  sunset: { sky: 0xffc39a, sun: 0xffb066, ambient: 0xffbf9c, ambientI: 0.66, dir: [7, 3, 2] },
  night: { sky: 0x2b3a68, sun: 0xa8c4ff, ambient: 0x4a5f9e, ambientI: 0.55, dir: [-3, 7, -2] },
};

/** Scatter helper: places `count` items in a ring, avoiding the middle stage. */
function scatter(
  root: THREE.Group,
  rand: () => number,
  count: number,
  innerR: number,
  outerR: number,
  make: (i: number, r: () => number) => THREE.Object3D | null,
) {
  for (let i = 0; i < count; i++) {
    const obj = make(i, rand);
    if (!obj) continue;
    const a = rand() * Math.PI * 2;
    const r = innerR + Math.sqrt(rand()) * (outerR - innerR);
    obj.position.set(Math.cos(a) * r, obj.position.y, Math.sin(a) * r);
    obj.rotation.y = rand() * Math.PI * 2;
    root.add(obj);
  }
}

function groundDisc(color: number, radius = 40): THREE.Mesh {
  const m = new THREE.Mesh(geo.circle(radius, 48), toon(color));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/** Rolling hills on the horizon — cheap depth without a skybox texture. */
function hills(root: THREE.Group, rand: () => number, color: number, count = 7, dist = 26) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.3;
    const r = 1.8 + rand() * 2.4;
    const hill = new THREE.Mesh(geo.sphere(1, 20), toon(shade(color, -0.05 + rand() * 0.18)));
    hill.scale.set(r * 2.4, r, r * 2.4);
    hill.position.set(Math.cos(a) * dist, -r * 0.25, Math.sin(a) * dist);
    root.add(hill);
  }
}

/* ------------------------------------------------------------------ *
 * Themes
 * ------------------------------------------------------------------ */

type ThemeBuilder = (spec: EnvironmentSpec, rand: () => number, root: THREE.Group) => Partial<BuiltEnvironment>;

const THEMES: Record<EnvironmentTheme, ThemeBuilder> = {
  garden: (spec, rand, root) => {
    const density = spec.density ?? 0.6;
    root.add(groundDisc(PALETTE.leafLight));
    // Narrow planted borders rather than open soil. Big bare discs read as mud
    // puddles from a low camera; a thin strip under the flowers reads as a bed.
    for (const [x, z, w] of [[-5.2, -4.2, 4.4], [5.0, -4.6, 3.6]] as const) {
      const bed = new THREE.Mesh(geo.plane(w, 1.5), toon(shade(PALETTE.soil, 0.1)));
      bed.rotation.x = -Math.PI / 2;
      bed.position.set(x, 0.012, z);
      root.add(bed);
    }
    hills(root, rand, PALETTE.leaf);

    scatter(root, rand, Math.round(34 * density), 2.6, 9, (i, r) =>
      buildProp(r() < 0.22 ? 'prop.tulip' : r() < 0.5 ? 'prop.daisy' : 'prop.flower', { seed: i * 17 + spec.seed, scale: 0.9 + r() * 0.5 }));
    scatter(root, rand, Math.round(40 * density), 2.2, 12, (i, r) =>
      buildProp('prop.grass-tuft', { seed: i * 7 + spec.seed, scale: 0.8 + r() * 0.7 }));
    scatter(root, rand, Math.round(6 * density), 6, 13, (i) =>
      buildProp('prop.bush', { seed: i * 31 + spec.seed }));
    scatter(root, rand, 3, 8, 14, (i) => buildProp('prop.blossom-tree', { seed: i * 13 + spec.seed }));

    const fence = buildProp('prop.fence', {});
    if (fence) { fence.position.set(0, 0, -9); fence.scale.setScalar(1.4); root.add(fence); }
    const can = buildProp('prop.watering-can', {});
    if (can) { can.position.set(-3.2, 0, 2.4); can.rotation.y = 0.7; root.add(can); }
    return {};
  },

  meadow: (spec, rand, root) => {
    const density = spec.density ?? 0.7;
    root.add(groundDisc(PALETTE.leaf));
    hills(root, rand, PALETTE.leafLight, 9, 24);
    scatter(root, rand, Math.round(70 * density), 1.5, 16, (i, r) =>
      buildProp('prop.grass-tuft', { seed: i * 5 + spec.seed, scale: 0.7 + r() * 0.8 }));
    scatter(root, rand, Math.round(26 * density), 2, 14, (i, r) =>
      buildProp('prop.flower', { seed: i * 19 + spec.seed, scale: 0.85 + r() * 0.4 }));
    scatter(root, rand, 5, 9, 16, (i) => buildProp('prop.tree', { seed: i * 23 + spec.seed }));
    return {};
  },

  forest: (spec, rand, root) => {
    const density = spec.density ?? 0.75;
    root.add(groundDisc(shade(PALETTE.moss, 0.1)));
    scatter(root, rand, Math.round(26 * density), 4.5, 18, (i, r) =>
      buildProp('prop.tree', { seed: i * 29 + spec.seed, color: r() < 0.3 ? PALETTE.moss : PALETTE.leafDeep, scale: 1 + r() * 0.7 }));
    scatter(root, rand, Math.round(20 * density), 2, 12, (i, r) =>
      buildProp('prop.mushroom', { seed: i * 11 + spec.seed, color: r() < 0.5 ? PALETTE.strawberry : PALETTE.orange, scale: 0.8 + r() * 0.6 }));
    scatter(root, rand, Math.round(16 * density), 2, 13, (i) => buildProp('prop.moss-patch', { seed: i * 3 + spec.seed }));
    scatter(root, rand, Math.round(10 * density), 3, 12, (i) => buildProp('prop.pinecone', { seed: i * 41 + spec.seed }));
    scatter(root, rand, 3, 4, 9, (i) => buildProp('prop.rock', { seed: i * 37 + spec.seed }));
    const log = buildProp('prop.log', {});
    if (log) { log.position.set(2.6, 0, 1.4); log.rotation.y = -0.5; root.add(log); }
    return {
      // Forests are darker and greener; the fog does most of that work.
      fog: new THREE.Fog(0x9fd0a8, 14, 40),
      ambientColor: 0xb6e0c0,
    };
  },

  sky: (spec, rand, root) => {
    // No ground at all — characters fly. Clouds form a soft floor instead.
    for (let i = 0; i < 22; i++) {
      const c = buildProp('prop.cloud', { seed: i * 13 + spec.seed });
      if (!c) continue;
      const a = rand() * Math.PI * 2;
      const r = 3 + rand() * 22;
      c.position.set(Math.cos(a) * r, -1.5 - rand() * 5 + (i % 3) * 2, Math.sin(a) * r);
      c.scale.setScalar(1 + rand() * 2.2);
      root.add(c);
    }
    const sun = buildProp('prop.sun', {});
    if (sun) { sun.position.set(-9, 7, -14); sun.scale.setScalar(2.2); root.add(sun); }
    if (spec.weather === 'rainbow') {
      const rb = buildProp('prop.rainbow', {});
      if (rb) { rb.position.set(0, -1, -16); rb.scale.setScalar(3.4); root.add(rb); }
    }
    return { fog: null, groundY: -100 };
  },

  pond: (spec, rand, root) => {
    root.add(groundDisc(PALETTE.leaf));
    const water = new THREE.Mesh(geo.circle(6, 40), toon({ color: PALETTE.water, transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.02;
    root.add(water);
    const rim = new THREE.Mesh(geo.torus(6, 0.24, 40), toon(PALETTE.sand));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.04;
    root.add(rim);
    scatter(root, rand, 7, 1.5, 5, (i, r) => {
      const p = buildProp('prop.lilypad', { seed: i * 7 + spec.seed, scale: 0.8 + r() * 0.6 });
      if (p) p.position.y = 0.05;
      return p;
    });
    scatter(root, rand, 14, 6.4, 12, (i, r) => buildProp('prop.grass-tuft', { seed: i * 5 + spec.seed, scale: 1 + r() }));
    scatter(root, rand, 4, 7, 13, (i) => buildProp('prop.tree', { seed: i * 19 + spec.seed }));
    hills(root, rand, PALETTE.leaf, 6, 22);
    return {};
  },

  classroom: (_spec, rand, root) => {
    const floor = new THREE.Mesh(geo.plane(14, 14), toon(PALETTE.wood));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    root.add(floor);
    const wallMat = toon(0xf3e9d8);
    const back = new THREE.Mesh(geo.plane(14, 6), wallMat);
    back.position.set(0, 3, -7);
    root.add(back);
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(geo.plane(14, 6), wallMat);
      w.position.set(side * 7, 3, 0);
      w.rotation.y = -side * Math.PI / 2;
      root.add(w);
    }
    // Skirting board — the detail that stops a room reading as a cardboard box.
    const skirt = shape(geo.box(14, 0.24, 0.1), PALETTE.offWhite, { outline: false });
    skirt.position.set(0, 0.12, -6.94);
    root.add(skirt);

    const board = buildProp('prop.chalkboard', {});
    if (board) { board.position.set(0, 0, -6.85); root.add(board); }

    for (let i = 0; i < 6; i++) {
      const x = (i % 3) * 2.6 - 2.6;
      const z = Math.floor(i / 3) * 2.2 - 1;
      const desk = buildProp('prop.desk', {});
      if (desk) { desk.position.set(x, 0, z); root.add(desk); }
      const chair = buildProp('prop.chair', { color: [PALETTE.plastic, PALETTE.petalPink, PALETTE.honey][i % 3] });
      if (chair) { chair.position.set(x, 0, z + 0.85); chair.rotation.y = Math.PI; root.add(chair); }
    }
    // A window with a slice of garden outside.
    const win = new THREE.Mesh(geo.plane(2.6, 1.8), flat(PALETTE.sky));
    win.position.set(6.94, 2.4, 1.5);
    win.rotation.y = -Math.PI / 2;
    root.add(win);
    const frame = shape(geo.box(0.08, 2, 2.8), PALETTE.offWhite, { outline: false });
    frame.position.set(6.9, 2.4, 1.5);
    root.add(frame);

    scatter(root, rand, 4, 3.5, 6, (i) => buildProp('prop.book', { seed: i, color: [PALETTE.strawberry, PALETTE.leaf, PALETTE.petalPurple, PALETTE.orange][i % 4] }));
    return {
      background: new THREE.Color(0xf3e9d8),
      fog: null,
      sunColor: 0xfff6e4,
      ambientColor: 0xffeedd,
      ambientIntensity: 0.9,
    };
  },

  kitchen: (_spec, _rand, root) => {
    const floor = new THREE.Mesh(geo.plane(12, 12), toon(0xe8e2d6));
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    // Chequerboard tiles.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if ((i + j) % 2) continue;
        const t = new THREE.Mesh(geo.plane(1.2, 1.2), flat(0xd3ccc0));
        t.rotation.x = -Math.PI / 2;
        t.position.set((i - 3.5) * 1.2, 0.005, (j - 3.5) * 1.2);
        root.add(t);
      }
    }
    const back = new THREE.Mesh(geo.plane(12, 6), toon(PALETTE.mint));
    back.position.set(0, 3, -6);
    root.add(back);
    const counter = shape(geo.box(7, 0.16, 1.1), PALETTE.offWhite);
    counter.position.set(0, 0.95, -5.3);
    root.add(counter);
    const cupboard = shape(geo.box(7, 0.9, 1), PALETTE.wood);
    cupboard.position.set(0, 0.48, -5.35);
    root.add(cupboard);
    const upper = shape(geo.box(4, 1.1, 0.7), PALETTE.wood);
    upper.position.set(-1.4, 2.6, -5.6);
    root.add(upper);
    for (let i = 0; i < 4; i++) {
      const fruit = buildProp(['prop.apple', 'prop.lemon', 'prop.strawberry', 'prop.apple'][i], {});
      if (fruit) { fruit.position.set(1.6 + i * 0.5, 1.03, -5.3); root.add(fruit); }
    }
    return { background: new THREE.Color(0xdff2e8), fog: null, ambientColor: 0xfff2e0, ambientIntensity: 0.9 };
  },

  bedroom: (_spec, _rand, root) => {
    const floor = new THREE.Mesh(geo.plane(11, 11), toon(PALETTE.wood));
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    const rug = new THREE.Mesh(geo.circle(2.4, 28), toon(PALETTE.petalBlush));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.01;
    root.add(rug);
    const back = new THREE.Mesh(geo.plane(11, 6), toon(0xdfe9ff));
    back.position.set(0, 3, -5.5);
    root.add(back);
    // Bed.
    const bed = shape(geo.box(2.2, 0.5, 3.2), PALETTE.wood);
    bed.position.set(-2.6, 0.35, -3);
    root.add(bed);
    const duvet = shape(geo.box(2.3, 0.3, 2.4), PALETTE.skyDeep);
    duvet.position.set(-2.6, 0.72, -2.6);
    root.add(duvet);
    const pillow = shape(geo.capsule(0.22, 0.9, 10), PALETTE.offWhite);
    pillow.rotation.z = Math.PI / 2;
    pillow.position.set(-2.6, 0.74, -4.1);
    root.add(pillow);
    const lamp = shape(geo.cone(0.3, 0.4, 12), PALETTE.honey);
    lamp.position.set(-0.6, 1.3, -4.6);
    root.add(lamp);
    return { background: new THREE.Color(0xcfdcf5), fog: null, ambientColor: 0xe8ecff, ambientIntensity: 0.85 };
  },

  void: (_spec, _rand, root) => {
    // Deliberately empty — a neutral stage for title cards and character tests.
    const disc = new THREE.Mesh(geo.circle(14, 40), toon(0xe9e4f2));
    disc.rotation.x = -Math.PI / 2;
    disc.receiveShadow = true;
    root.add(disc);
    return { background: new THREE.Color(0xf6f2ff), fog: null };
  },
};

/* ------------------------------------------------------------------ *
 * Weather overlays
 * ------------------------------------------------------------------ */

function addWeather(root: THREE.Group, spec: EnvironmentSpec, rand: () => number) {
  if (!spec.weather || spec.weather === 'clear') return;
  if (spec.weather === 'cloudy') {
    for (let i = 0; i < 7; i++) {
      const c = buildProp('prop.cloud', { seed: i * 3 + spec.seed, color: PALETTE.cloudShade });
      if (!c) continue;
      c.position.set((rand() - 0.5) * 34, 8 + rand() * 5, (rand() - 0.5) * 34);
      c.scale.setScalar(1.6 + rand() * 1.6);
      root.add(c);
    }
  } else if (spec.weather === 'rainbow') {
    const rb = buildProp('prop.rainbow', {});
    if (rb) { rb.position.set(0, 0.5, -15); rb.scale.setScalar(3); root.add(rb); }
  }
  // 'petals' and 'snow' are particle effects, added by the FX layer instead —
  // they need per-frame simulation, which environments deliberately don't do.
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function buildEnvironment(spec: EnvironmentSpec): BuiltEnvironment {
  const root = new THREE.Group();
  root.name = `env:${spec.theme}`;
  const rand = mulberry(spec.seed);
  const tod = TIME_OF_DAY[spec.timeOfDay ?? 'noon'] ?? TIME_OF_DAY.noon;

  // Chroma-key mode replaces the whole set with flat green. Characters still
  // stand on an invisible floor so their contact shadows land correctly.
  if (spec.chromaKey) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ color: PALETTE.chromaGreen, side: THREE.BackSide }),
    );
    root.add(dome);
    const floor = new THREE.Mesh(geo.circle(40, 32), flat(PALETTE.chromaGreen));
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    return {
      root,
      background: new THREE.Color(PALETTE.chromaGreen),
      fog: null,
      // Flat, shadowless light: any shading on green makes the key harder.
      sunDirection: new THREE.Vector3(0, 10, 6),
      sunColor: 0xffffff,
      ambientColor: 0xffffff,
      ambientIntensity: 1.15,
      groundY: 0,
    };
  }

  const overrides = THEMES[spec.theme](spec, rand, root);
  addWeather(root, spec, rand);

  const base: BuiltEnvironment = {
    root,
    background: new THREE.Color(tod.sky),
    fog: new THREE.Fog(tod.sky, 22, 60),
    sunDirection: new THREE.Vector3(...tod.dir),
    sunColor: tod.sun,
    ambientColor: tod.ambient,
    ambientIntensity: tod.ambientI,
    groundY: 0,
  };
  return { ...base, ...overrides };
}

export interface EnvironmentDef {
  theme: EnvironmentTheme;
  name: string;
  description: string;
  outdoor: boolean;
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  { theme: 'garden', name: 'Garden', description: 'Flower beds, a fence and blossom trees. Buzzy\'s home turf.', outdoor: true },
  { theme: 'meadow', name: 'Meadow', description: 'Open grass and wildflowers, with room to run.', outdoor: true },
  { theme: 'forest', name: 'Forest', description: 'Tall trees, moss and toadstools. Softly foggy.', outdoor: true },
  { theme: 'pond', name: 'Pond', description: 'Water, lily pads and a sandy rim.', outdoor: true },
  { theme: 'sky', name: 'Sky', description: 'Clouds and sunshine, no ground. For flying scenes.', outdoor: true },
  { theme: 'classroom', name: 'Classroom', description: 'Desks, chairs and a chalkboard.', outdoor: false },
  { theme: 'kitchen', name: 'Kitchen', description: 'Counters, tiles and a fruit bowl.', outdoor: false },
  { theme: 'bedroom', name: 'Bedroom', description: 'Bed, rug and a warm lamp.', outdoor: false },
  { theme: 'void', name: 'Plain stage', description: 'An empty pastel stage. Good for titles and character tests.', outdoor: false },
];
