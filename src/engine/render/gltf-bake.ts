/**
 * glTF export.
 *
 * The studio's animation is procedural — it's a function of time, not a stored
 * curve — which is wonderful for editing and useless to any other program. This
 * module samples that function and turns it back into ordinary keyframe tracks
 * so a scene can be opened in Blender, Maya, Unity or anything else that reads
 * glTF.
 *
 * What gets baked:
 *   - every rig joint's rotation, as quaternions (glTF has no Euler tracks, and
 *     baking to quaternions also removes any gimbal ambiguity)
 *   - each node's root position, rotation and scale
 *   - the camera, following the same cuts as the film
 *
 * What doesn't: particles, the 2D composite layer, and the audio. Those are
 * listed in the export notes rather than silently dropped.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Project, SceneDoc } from '../types';
import { SceneRuntime } from '../scene-builder';
import { composeShot, shotAt } from './director';

export interface BakeSceneOptions {
  /** Samples per second. 24 is plenty for playback; 30 matches the film. */
  fps?: number;
  /** Include an animated camera that follows the film's cuts. */
  camera?: boolean;
  /** Strip the inverted-hull outlines, which read as inside-out shells. */
  stripOutlines?: boolean;
}

interface Sampler {
  times: number[];
  /** Flat [x,y,z,w,…] for quaternions or [x,y,z,…] for vectors. */
  values: number[];
}

function newSampler(): Sampler {
  return { times: [], values: [] };
}

/**
 * Drop samples that sit on the straight line between their neighbours.
 *
 * A 90-second scene at 30fps is 2,700 samples per channel; most joints barely
 * move for most of that. Without this pass a single .glb runs to hundreds of
 * megabytes of keys nobody can scrub through.
 */
function decimate(s: Sampler, stride: number, tolerance: number): Sampler {
  const count = s.times.length;
  if (count < 3) return s;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  let last = 0;
  for (let i = 1; i < count - 1; i++) {
    const next = i + 1;
    const span = s.times[next] - s.times[last];
    const u = span <= 1e-9 ? 0 : (s.times[i] - s.times[last]) / span;
    let deviation = 0;
    for (let c = 0; c < stride; c++) {
      const a = s.values[last * stride + c];
      const b = s.values[next * stride + c];
      const actual = s.values[i * stride + c];
      deviation = Math.max(deviation, Math.abs(actual - (a + (b - a) * u)));
    }
    if (deviation > tolerance) {
      keep[i] = 1;
      last = i;
    }
  }
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!keep[i]) continue;
    times.push(s.times[i]);
    for (let c = 0; c < stride; c++) values.push(s.values[i * stride + c]);
  }
  return { times, values };
}

function trackName(object: THREE.Object3D, property: string): string {
  return `${object.uuid}.${property}`;
}

export interface BakedScene {
  sceneId: string;
  name: string;
  /** Binary .glb contents. */
  data: Uint8Array;
  start: number;
  duration: number;
  frames: number;
  keyCount: number;
}

export async function bakeSceneToGLB(
  project: Project,
  scene: SceneDoc,
  options: BakeSceneOptions = {},
): Promise<BakedScene> {
  const fps = options.fps ?? 24;

  // The scene's span on the master timeline: from its first shot to its last.
  const shots = project.sequence.filter((s) => s.sceneId === scene.id);
  const start = shots.length ? Math.min(...shots.map((s) => s.start)) : 0;
  const end = shots.length ? Math.max(...shots.map((s) => s.start + s.duration)) : project.meta.duration;
  const duration = Math.max(1 / fps, end - start);
  const frames = Math.max(2, Math.round(duration * fps));

  const runtime = new SceneRuntime(scene, { shadows: false });

  /* ---- what we're going to sample ---- */
  const targets: { object: THREE.Object3D; pos?: Sampler; quat?: Sampler; scale?: Sampler }[] = [];
  const register = (object: THREE.Object3D, opts: { pos?: boolean; scale?: boolean }) => {
    const entry: (typeof targets)[number] = { object, quat: newSampler() };
    if (opts.pos) entry.pos = newSampler();
    if (opts.scale) entry.scale = newSampler();
    targets.push(entry);
    return entry;
  };

  for (const node of runtime.nodes.values()) {
    if (node.doc.kind === 'fx') continue;
    register(node.object, { pos: true, scale: true });
    const ch = node.character;
    if (!ch) continue;
    for (const joint of ch.joints.values()) register(joint, {});
  }

  /* ---- camera ---- */
  let cameraObject: THREE.Object3D | null = null;
  let cameraEntry: (typeof targets)[number] | null = null;
  const camera = new THREE.PerspectiveCamera(38, project.meta.width / project.meta.height, 0.1, 200);
  if (options.camera !== false) {
    camera.name = 'FilmCamera';
    runtime.scene.add(camera);
    cameraObject = camera;
    cameraEntry = register(camera, { pos: true });
  }

  /* ---- sample ---- */
  const aspect = project.meta.width / project.meta.height;
  const _q = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = start + (f / fps);
    const local = f / fps;
    runtime.update(t, 1 / fps);

    if (cameraObject) {
      const hit = shotAt(project.sequence, t);
      if (hit && hit.shot.sceneId === scene.id) {
        const state = composeShot(runtime, hit.shot, hit.u, aspect);
        camera.position.copy(state.position);
        camera.lookAt(state.target);
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      }
    }

    for (const entry of targets) {
      const o = entry.object;
      if (entry.pos) {
        entry.pos.times.push(local);
        entry.pos.values.push(o.position.x, o.position.y, o.position.z);
      }
      if (entry.scale) {
        entry.scale.times.push(local);
        entry.scale.values.push(o.scale.x, o.scale.y, o.scale.z);
      }
      if (entry.quat) {
        _q.setFromEuler(o.rotation);
        entry.quat.times.push(local);
        entry.quat.values.push(_q.x, _q.y, _q.z, _q.w);
      }
    }
  }
  void cameraEntry;

  /* ---- build tracks ---- */
  const tracks: THREE.KeyframeTrack[] = [];
  let keyCount = 0;
  for (const entry of targets) {
    if (entry.pos) {
      const s = decimate(entry.pos, 3, 0.0008);
      if (s.times.length > 1) {
        tracks.push(new THREE.VectorKeyframeTrack(trackName(entry.object, 'position'), s.times, s.values));
        keyCount += s.times.length;
      }
    }
    if (entry.quat) {
      const s = decimate(entry.quat, 4, 0.0009);
      if (s.times.length > 1) {
        tracks.push(new THREE.QuaternionKeyframeTrack(trackName(entry.object, 'quaternion'), s.times, s.values));
        keyCount += s.times.length;
      }
    }
    if (entry.scale) {
      const s = decimate(entry.scale, 3, 0.0012);
      if (s.times.length > 1) {
        tracks.push(new THREE.VectorKeyframeTrack(trackName(entry.object, 'scale'), s.times, s.values));
        keyCount += s.times.length;
      }
    }
  }

  const clip = new THREE.AnimationClip(scene.name || scene.id, duration, tracks);

  /* ---- tidy the scene for export ---- */
  if (options.stripOutlines !== false) {
    const doomed: THREE.Object3D[] = [];
    runtime.scene.traverse((o) => { if (o.userData.isOutline) doomed.push(o); });
    // Outlines are inside-out shells; in any other program they render as a
    // dark blob swallowing the model.
    for (const o of doomed) o.removeFromParent();
  }
  // Particle clouds are simulated per frame here and have no glTF equivalent.
  runtime.fx.root.removeFromParent();

  runtime.scene.name = scene.name;

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(runtime.scene, {
    binary: true,
    animations: [clip],
    onlyVisible: true,
    // Keep the toon look readable: the exporter maps MeshToonMaterial onto a
    // standard PBR material, and without this the base colours are correct but
    // everything arrives fully rough.
    includeCustomExtensions: true,
  });

  runtime.dispose();

  const data = result instanceof ArrayBuffer
    ? new Uint8Array(result)
    : new TextEncoder().encode(JSON.stringify(result));

  return { sceneId: scene.id, name: scene.name, data, start, duration, frames, keyCount };
}
