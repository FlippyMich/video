/**
 * Materials.
 *
 * Everything in the studio uses a three-step toon ramp plus an inverted-hull
 * outline. That combination is what makes flat-shaded primitives read as
 * "drawn" rather than "untextured 3D", and it costs almost nothing to render —
 * which matters when the target machine is a school Chromebook.
 *
 * Materials are cached by colour so a meadow with 400 grass blades still only
 * compiles one shader.
 */

import * as THREE from 'three';

let gradientMap: THREE.DataTexture | null = null;

/** Three-band ramp: shadow, mid, light. Four bands starts to look like PBR. */
function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const steps = new Uint8Array([90, 175, 235, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  gradientMap = tex;
  return tex;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
const basicCache = new Map<string, THREE.MeshBasicMaterial>();
const outlineCache = new Map<string, THREE.MeshBasicMaterial>();

export interface ToonOptions {
  color: number;
  /** Self-lit glow, for fireflies, sparkles and glowing eyes. */
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

export function toon(opts: ToonOptions | number): THREE.MeshToonMaterial {
  const o: ToonOptions = typeof opts === 'number' ? { color: opts } : opts;
  const key = `${o.color}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 0}|${o.transparent ? 1 : 0}|${o.opacity ?? 1}|${o.side ?? 0}`;
  const hit = toonCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshToonMaterial({
    color: o.color,
    gradientMap: getGradientMap(),
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  toonCache.set(key, mat);
  return mat;
}

/** Unlit flat colour — eye whites, chroma backdrops, UI-in-world elements. */
export function flat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  const hit = basicCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
  basicCache.set(key, mat);
  return mat;
}

function outlineMaterial(color: number): THREE.MeshBasicMaterial {
  const key = String(color);
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  outlineCache.set(key, mat);
  return mat;
}

export const OUTLINE_COLOR = 0x39304a;

/**
 * Add an inverted-hull outline to a mesh.
 *
 * The hull is a child rather than a sibling, so it inherits every transform the
 * mesh gets — including the squash-and-stretch that clips apply — for free.
 */
export function outline(mesh: THREE.Mesh, thickness = 0.03, color = OUTLINE_COLOR): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(color));
  // Scale is uniform in *local* space, so thin objects get a proportionally
  // thicker line — which is what a hand-drawn outline does anyway.
  const s = 1 + thickness;
  hull.scale.setScalar(s);
  hull.userData.isOutline = true;
  hull.renderOrder = -1;
  mesh.add(hull);
  return hull;
}

/** Convenience: a toon mesh with its outline already attached. */
export function shape(
  geometry: THREE.BufferGeometry,
  color: number | ToonOptions,
  opts: { outline?: number | false; castShadow?: boolean } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = true;
  if (opts.outline !== false) outline(mesh, opts.outline ?? 0.035);
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Geometry cache
 *
 * The environment generators create thousands of instances of a dozen shapes;
 * sharing the BufferGeometry keeps a forest under one draw-call budget.
 * ------------------------------------------------------------------ */

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const geo = make();
  geoCache.set(key, geo);
  return geo;
}

export const geo = {
  sphere: (r = 1, seg = 20) => cached(`sph${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1))),
  box: (w = 1, h = 1, d = 1) => cached(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)),
  /** Rounded box, via a heavily-segmented sphere squashed to shape. */
  capsule: (r = 0.2, len = 0.5, seg = 12) => cached(`cap${r}|${len}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 4, seg)),
  cylinder: (rt = 0.2, rb = 0.2, h = 1, seg = 16) =>
    cached(`cyl${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: (r = 0.3, h = 0.6, seg = 16) => cached(`cone${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r = 0.3, tube = 0.1, seg = 16) => cached(`tor${r}|${tube}|${seg}`, () => new THREE.TorusGeometry(r, tube, 10, seg)),
  plane: (w = 1, h = 1) => cached(`pln${w}|${h}`, () => new THREE.PlaneGeometry(w, h)),
  circle: (r = 1, seg = 24) => cached(`cir${r}|${seg}`, () => new THREE.CircleGeometry(r, seg)),
  /** A flat petal / leaf blade — a squashed, tapered shape used everywhere. */
  petal: (len = 0.4, wide = 0.22) =>
    cached(`petal${len}|${wide}`, () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(wide, len * 0.25, wide * 0.8, len * 0.85, 0, len);
      s.bezierCurveTo(-wide * 0.8, len * 0.85, -wide, len * 0.25, 0, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 });
      g.center();
      g.translate(0, len / 2, 0);
      return g;
    }),
  /** A rounded five-point star, for sparkles and the logo. */
  star: (r = 0.3, points = 5) =>
    cached(`star${r}|${points}`, () => {
      const s = new THREE.Shape();
      const inner = r * 0.44;
      for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : inner;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: r * 0.25, bevelEnabled: true, bevelSize: r * 0.08, bevelThickness: r * 0.06, bevelSegments: 2 });
      g.center();
      return g;
    }),
};

/** Free every cached GPU resource. Called when the editor tears a project down. */
export function disposeCaches(): void {
  toonCache.forEach((m) => m.dispose());
  basicCache.forEach((m) => m.dispose());
  outlineCache.forEach((m) => m.dispose());
  geoCache.forEach((g) => g.dispose());
  toonCache.clear();
  basicCache.clear();
  outlineCache.clear();
  geoCache.clear();
  gradientMap?.dispose();
  gradientMap = null;
}
