/**
 * Physics and cloth.
 *
 * Verlet integration with distance constraints — the same technique behind most
 * cloth in games, and the right choice here for one specific reason: it is
 * *deterministic and stateless across seeks*. The whole engine treats animation
 * as a pure function of time, and a solver that accumulates velocity from frame
 * to frame would break scrubbing, break the headless render's agreement with the
 * preview, and make every export subtly different.
 *
 * So simulation runs from `t = 0` at a fixed step, and seeking backwards
 * re-simulates from the start. A cloth of a few hundred points costs well under
 * a millisecond a step, so re-running four seconds of it to scrub is cheaper
 * than the frame it is being drawn into.
 */

import * as THREE from 'three';

const FIXED_STEP = 1 / 120;
/** Re-simulating more than this many steps in one seek would stall the UI. */
const MAX_CATCHUP_STEPS = 2400;

export interface SolverOptions {
  gravity?: number;
  /** Velocity retained each step. 1 is frictionless, 0.97 is air. */
  damping?: number;
  /** Constraint passes per step. More is stiffer and slower. */
  iterations?: number;
  /** Ground plane height, or null for no floor. */
  floor?: number | null;
  bounce?: number;
  /** Steady wind, in world units per second squared. */
  wind?: THREE.Vector3;
  windGust?: number;
}

interface Point {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  /** 0 = pinned. Otherwise the reciprocal of mass. */
  invMass: number;
}

interface Constraint {
  a: number;
  b: number;
  rest: number;
  /** 0..1 — how much of the correction to apply per pass. */
  stiffness: number;
}

export class VerletSolver {
  points: Point[] = [];
  constraints: Constraint[] = [];
  private opts: Required<Omit<SolverOptions, 'floor'>> & { floor: number | null };
  private simulatedTo = 0;
  /** Snapshot of the rest state, so a backwards seek can restart cleanly. */
  private initial: { pos: THREE.Vector3; invMass: number }[] = [];

  constructor(options: SolverOptions = {}) {
    this.opts = {
      gravity: options.gravity ?? 9.4,
      damping: options.damping ?? 0.985,
      iterations: options.iterations ?? 6,
      floor: options.floor === undefined ? 0 : options.floor,
      bounce: options.bounce ?? 0.35,
      wind: options.wind ?? new THREE.Vector3(),
      windGust: options.windGust ?? 0,
    };
  }

  addPoint(position: THREE.Vector3, invMass = 1): number {
    this.points.push({ pos: position.clone(), prev: position.clone(), invMass });
    return this.points.length - 1;
  }

  addConstraint(a: number, b: number, stiffness = 1, rest?: number) {
    this.constraints.push({
      a, b, stiffness,
      rest: rest ?? this.points[a].pos.distanceTo(this.points[b].pos),
    });
  }

  /** Call once every point and constraint exists. */
  freeze() {
    this.initial = this.points.map((p) => ({ pos: p.pos.clone(), invMass: p.invMass }));
  }

  private reset() {
    this.points.forEach((p, i) => {
      const init = this.initial[i];
      if (!init) return;
      p.pos.copy(init.pos);
      p.prev.copy(init.pos);
      p.invMass = init.invMass;
    });
    this.simulatedTo = 0;
  }

  /** Move a pinned point — an anchor following a character's hand, say. */
  pin(index: number, position: THREE.Vector3) {
    const p = this.points[index];
    if (!p) return;
    p.pos.copy(position);
    p.prev.copy(position);
    p.invMass = 0;
  }

  /**
   * Advance the simulation to absolute time `t`.
   *
   * Seeking backwards restarts from rest and re-simulates, which is what keeps
   * the result identical no matter how the user got to this frame.
   */
  simulateTo(t: number) {
    if (t < this.simulatedTo - 1e-6) this.reset();
    let steps = Math.floor((t - this.simulatedTo) / FIXED_STEP);
    if (steps <= 0) return;
    if (steps > MAX_CATCHUP_STEPS) {
      // A very long jump: skip ahead rather than freeze. The cloth will settle
      // within a few frames, which is far better than a stalled interface.
      this.reset();
      steps = MAX_CATCHUP_STEPS;
      this.simulatedTo = t - steps * FIXED_STEP;
    }
    for (let i = 0; i < steps; i++) {
      this.step(this.simulatedTo);
      this.simulatedTo += FIXED_STEP;
    }
  }

  private _acc = new THREE.Vector3();
  private _delta = new THREE.Vector3();

  private step(time: number) {
    const { gravity, damping, iterations, floor, bounce, wind, windGust } = this.opts;
    const dt2 = FIXED_STEP * FIXED_STEP;

    // Wind gusts use a sine rather than a random walk, for the same
    // determinism reason as everything else here.
    const gust = windGust ? 1 + windGust * Math.sin(time * 1.7) * Math.sin(time * 0.63 + 1.1) : 1;

    for (const p of this.points) {
      if (p.invMass === 0) continue;
      this._acc.set(wind.x * gust, -gravity + wind.y * gust, wind.z * gust);
      // x' = x + (x - xPrev) * damping + a * dt²
      this._delta.copy(p.pos).sub(p.prev).multiplyScalar(damping);
      p.prev.copy(p.pos);
      p.pos.add(this._delta).addScaledVector(this._acc, dt2);
    }

    for (let k = 0; k < iterations; k++) {
      for (const c of this.constraints) {
        const a = this.points[c.a];
        const b = this.points[c.b];
        const w = a.invMass + b.invMass;
        if (w === 0) continue;
        this._delta.copy(b.pos).sub(a.pos);
        const len = this._delta.length();
        if (len < 1e-9) continue;
        const correction = ((len - c.rest) / len) * c.stiffness;
        a.pos.addScaledVector(this._delta, (a.invMass / w) * correction);
        b.pos.addScaledVector(this._delta, -(b.invMass / w) * correction);
      }
    }

    if (floor !== null) {
      for (const p of this.points) {
        if (p.invMass === 0 || p.pos.y >= floor) continue;
        p.pos.y = floor;
        // Reflect the implied velocity rather than zeroing it, so a ball
        // bounces instead of sticking. In Verlet the velocity *is*
        // `pos - prev`, so an upward rebound means putting `prev` below the
        // new position — putting it above leaves the body still travelling
        // down and it sinks into the floor instead of bouncing.
        const speed = p.prev.y - p.pos.y;
        p.prev.y = p.pos.y - speed * bounce;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Cloth
 * ------------------------------------------------------------------ */

export interface ClothOptions extends SolverOptions {
  width?: number;
  height?: number;
  /** Points across and down. 12×12 is plenty for a cape at this scale. */
  cols?: number;
  rows?: number;
  color?: number;
  /** Which corners are pinned: 'top-corners', 'top-edge', 'left-edge', 'none'. */
  pin?: 'top-corners' | 'top-edge' | 'left-edge' | 'none';
  stiffness?: number;
  doubleSided?: boolean;
}

export interface ClothInstance {
  mesh: THREE.Mesh;
  solver: VerletSolver;
  update(t: number): void;
  dispose(): void;
}

/**
 * A simulated sheet — a flag, a cape, a picnic blanket, a curtain.
 *
 * Structural constraints hold the grid together; shear constraints along the
 * diagonals stop it collapsing into a parallelogram; bend constraints between
 * every other point stop it folding flat on itself. Leave any of the three out
 * and the cloth fails in a characteristic and very obvious way.
 */
export function buildCloth(options: ClothOptions = {}): ClothInstance {
  const width = options.width ?? 1.2;
  const height = options.height ?? 1.0;
  const cols = Math.max(2, options.cols ?? 12);
  const rows = Math.max(2, options.rows ?? 12);
  const stiffness = options.stiffness ?? 0.9;

  const solver = new VerletSolver({
    gravity: options.gravity ?? 6.5,
    damping: options.damping ?? 0.982,
    iterations: options.iterations ?? 8,
    floor: options.floor === undefined ? null : options.floor,
    wind: options.wind ?? new THREE.Vector3(0.5, 0, 0.25),
    windGust: options.windGust ?? 0.8,
  });

  const index = (c: number, r: number) => r * cols + c;
  const pinMode = options.pin ?? 'top-corners';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1) - 0.5) * width;
      const y = -(r / (rows - 1)) * height;
      const pinned =
        (pinMode === 'top-corners' && r === 0 && (c === 0 || c === cols - 1)) ||
        (pinMode === 'top-edge' && r === 0) ||
        (pinMode === 'left-edge' && c === 0);
      solver.addPoint(new THREE.Vector3(x, y, 0), pinned ? 0 : 1);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = index(c, r);
      if (c < cols - 1) solver.addConstraint(i, index(c + 1, r), stiffness);
      if (r < rows - 1) solver.addConstraint(i, index(c, r + 1), stiffness);
      // Shear.
      if (c < cols - 1 && r < rows - 1) {
        solver.addConstraint(i, index(c + 1, r + 1), stiffness * 0.55);
        solver.addConstraint(index(c + 1, r), index(c, r + 1), stiffness * 0.55);
      }
      // Bend.
      if (c < cols - 2) solver.addConstraint(i, index(c + 2, r), stiffness * 0.28);
      if (r < rows - 2) solver.addConstraint(i, index(c, r + 2), stiffness * 0.28);
    }
  }
  solver.freeze();

  const geometry = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1);
  geometry.translate(0, -height / 2, 0);
  const position = geometry.attributes.position as THREE.BufferAttribute;

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshToonMaterial({
      color: options.color ?? 0xff8fb1,
      side: options.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
    }),
  );
  mesh.castShadow = true;

  const update = (t: number) => {
    solver.simulateTo(t);
    for (let i = 0; i < solver.points.length; i++) {
      const p = solver.points[i].pos;
      position.setXYZ(i, p.x, p.y, p.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };
  update(0);

  return {
    mesh,
    solver,
    update,
    dispose() {
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Rope
 * ------------------------------------------------------------------ */

export interface RopeInstance {
  mesh: THREE.Object3D;
  solver: VerletSolver;
  update(t: number): void;
  dispose(): void;
}

/** A hanging chain of beads — a balloon string, a swing, a wind chime cord. */
export function buildRope(options: {
  length?: number;
  segments?: number;
  radius?: number;
  color?: number;
  pinEnd?: boolean;
} & SolverOptions = {}): RopeInstance {
  const length = options.length ?? 1.4;
  const segments = Math.max(2, options.segments ?? 12);
  const radius = options.radius ?? 0.02;

  const solver = new VerletSolver({
    gravity: options.gravity ?? 9.4,
    damping: options.damping ?? 0.99,
    iterations: options.iterations ?? 10,
    floor: options.floor === undefined ? null : options.floor,
    // A rope with no wind hangs dead straight, which reads as a mistake.
    wind: options.wind ?? new THREE.Vector3(0.35, 0, 0.18),
    windGust: options.windGust ?? 0.9,
  });

  for (let i = 0; i < segments; i++) {
    solver.addPoint(new THREE.Vector3(0, -(i / (segments - 1)) * length, 0), i === 0 ? 0 : 1);
  }
  if (options.pinEnd) solver.points[segments - 1].invMass = 0;
  for (let i = 0; i < segments - 1; i++) solver.addConstraint(i, i + 1, 1);
  solver.freeze();

  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(radius, 8, 6);
  const material = new THREE.MeshToonMaterial({ color: options.color ?? 0xfff8ec });
  const beads: THREE.Mesh[] = [];
  for (let i = 0; i < segments; i++) {
    const bead = new THREE.Mesh(geometry, material);
    group.add(bead);
    beads.push(bead);
  }

  const update = (t: number) => {
    solver.simulateTo(t);
    for (let i = 0; i < segments; i++) beads[i].position.copy(solver.points[i].pos);
  };
  update(0);

  return {
    mesh: group,
    solver,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Rigid bodies
 * ------------------------------------------------------------------ */

export interface BouncerOptions extends SolverOptions {
  radius?: number;
  /** Initial velocity, in units per second. */
  velocity?: THREE.Vector3;
  start?: THREE.Vector3;
  color?: number;
}

/**
 * A single bouncing body.
 *
 * A full rigid-body engine is not what this studio is for — a ball that bounces
 * and a hoop that swings covers what a children's video actually needs, and it
 * stays inside the deterministic model everything else relies on.
 */
export function buildBouncer(options: BouncerOptions = {}): RopeInstance {
  const radius = options.radius ?? 0.24;
  const start = options.start ?? new THREE.Vector3(0, 2.4, 0);
  const velocity = options.velocity ?? new THREE.Vector3(0.9, 0, 0);

  const solver = new VerletSolver({
    gravity: options.gravity ?? 11,
    damping: options.damping ?? 0.999,
    floor: options.floor ?? radius,
    bounce: options.bounce ?? 0.72,
    iterations: 1,
  });
  const i = solver.addPoint(start, 1);
  // Verlet stores velocity as the gap between the current and previous
  // position, so an initial velocity is set by displacing the previous one.
  solver.points[i].prev.copy(start).addScaledVector(velocity, -FIXED_STEP);
  solver.freeze();

  const geometry = new THREE.SphereGeometry(radius, 20, 14);
  const material = new THREE.MeshToonMaterial({ color: options.color ?? 0xf5455c });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;

  return {
    mesh,
    solver,
    update(t: number) {
      solver.simulateTo(t);
      const point = solver.points[0];
      mesh.position.copy(point.pos);
      // Squash on impact — a perfectly rigid bounce reads as wrong on a
      // cartoon, and this is nearly free.
      //
      // Driven by speed, not by height: keying it to "how close to the floor"
      // leaves the ball permanently flattened once it comes to rest.
      const speed = Math.abs(point.pos.y - point.prev.y) / FIXED_STEP;
      const nearFloor = Math.max(0, 1 - (point.pos.y - radius) / (radius * 0.9));
      const squash = Math.min(1, (speed / 7) * nearFloor);
      mesh.scale.set(1 + squash * 0.24, 1 - squash * 0.24, 1 + squash * 0.24);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
