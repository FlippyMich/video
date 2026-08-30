/**
 * Scene runtime.
 *
 * Turns a `SceneDoc` into a live three.js scene, then drives it from the
 * timeline. `update(t)` is called once per frame during playback and once per
 * frame during export, and it is the only place animation is applied — so what
 * you scrub is exactly what renders.
 */

import * as THREE from 'three';
import type { AnimTrack, LightingPreset, SceneDoc, SceneNode } from './types';
import { sampleTrack } from './anim/keyframes';
import { buildCharacter, type CharacterInstance } from './assets/characters';
import { buildProp } from './assets/props';
import { buildEnvironment, type BuiltEnvironment } from './assets/environments';
import { EXPRESSION_IDS, blendExpressions, type ExpressionId } from './rig/expressions';
import { VISEME_IDS, blendVisemes, type VisemeId } from './rig/visemes';
import { buildTextMesh } from './assets/text3d';
import { FxSystem } from './fx/particles';
import { buildBouncer, buildCloth, buildRope } from './fx/physics';

export interface NodeRuntime {
  doc: SceneNode;
  /** Transform root. Animation writes here. */
  object: THREE.Object3D;
  character: CharacterInstance | null;
  light: THREE.Light | null;
  camera: THREE.PerspectiveCamera | null;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  baseScale: THREE.Vector3;
  tracks: Map<string, AnimTrack>;
  /** Scratch buffers, reused each frame to keep the update loop allocation-free. */
  expr: Partial<Record<ExpressionId, number>>;
  vis: Partial<Record<VisemeId, number>>;
}

const LIGHT_RIGS: Record<LightingPreset, { key: number; keyI: number; fill: number; fillI: number; rim: number; rimI: number; ambient: number; ambientI: number }> = {
  'soft-day':    { key: 0xfff6e0, keyI: 1.5, fill: 0xcfe6ff, fillI: 0.6, rim: 0xffffff, rimI: 0.5, ambient: 0xd8e8ff, ambientI: 0.75 },
  sunny:         { key: 0xfff2cc, keyI: 2.1, fill: 0xbfe0ff, fillI: 0.5, rim: 0xffffff, rimI: 0.8, ambient: 0xdcefff, ambientI: 0.7 },
  'golden-hour': { key: 0xffb066, keyI: 2.0, fill: 0xff9e7a, fillI: 0.45, rim: 0xffd9a0, rimI: 1.0, ambient: 0xffc9a0, ambientI: 0.6 },
  'indoor-warm': { key: 0xfff0d4, keyI: 1.4, fill: 0xffe4c0, fillI: 0.65, rim: 0xfff8ec, rimI: 0.35, ambient: 0xffeeda, ambientI: 0.9 },
  'night-moon':  { key: 0xa8c4ff, keyI: 1.0, fill: 0x5f74b8, fillI: 0.5, rim: 0xd6e4ff, rimI: 0.7, ambient: 0x4a5f9e, ambientI: 0.6 },
  stage:         { key: 0xffffff, keyI: 2.2, fill: 0xffd9e8, fillI: 0.7, rim: 0xd0e8ff, rimI: 1.2, ambient: 0xe8e0ff, ambientI: 0.55 },
  'flat-key':    { key: 0xffffff, keyI: 1.2, fill: 0xffffff, fillI: 1.0, rim: 0xffffff, rimI: 0.6, ambient: 0xffffff, ambientI: 1.15 },
};

/** A physics object that has to be stepped each frame. */
interface Simulation {
  update(t: number): void;
  dispose(): void;
}

export class SceneRuntime {
  readonly scene = new THREE.Scene();
  readonly nodes = new Map<string, NodeRuntime>();
  readonly fx = new FxSystem();
  private sims: Simulation[] = [];
  environment!: BuiltEnvironment;
  /** Default camera used when a shot doesn't name one. */
  readonly defaultCamera: THREE.PerspectiveCamera;
  private keyLight!: THREE.DirectionalLight;
  private doc: SceneDoc;
  private lookTarget: THREE.Vector3 | null = null;

  constructor(doc: SceneDoc, opts: { shadows?: boolean; aspect?: number; shadowMap?: number } = {}) {
    this.doc = doc;
    this.defaultCamera = new THREE.PerspectiveCamera(38, opts.aspect ?? 16 / 9, 0.1, 200);
    this.defaultCamera.position.set(0, 1.7, 6);
    this.defaultCamera.lookAt(0, 1.1, 0);
    this.build(opts.shadows ?? true, opts.shadowMap ?? 1024);
  }

  private build(shadows: boolean, shadowMap: number) {
    const env = buildEnvironment(this.doc.environment);
    this.environment = env;
    this.scene.add(env.root);
    this.scene.background = env.background;
    this.scene.fog = env.fog;
    this.scene.add(this.fx.root);

    const rig = LIGHT_RIGS[this.doc.lighting] ?? LIGHT_RIGS['soft-day'];
    const ambient = new THREE.AmbientLight(env.ambientColor ?? rig.ambient, (env.ambientIntensity ?? 1) * rig.ambientI);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(rig.key, rig.keyI);
    key.position.copy(env.sunDirection).multiplyScalar(1.4);
    if (shadows && !this.doc.environment.chromaKey) {
      key.castShadow = true;
      key.shadow.mapSize.set(shadowMap, shadowMap);
      const c = key.shadow.camera as THREE.OrthographicCamera;
      // Tight enough that the map's resolution lands on the characters rather
      // than on empty meadow. Anything outside simply doesn't cast.
      c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 0.5; c.far = 48;
      key.shadow.bias = -0.0012;
      key.shadow.normalBias = 0.03;
    }
    this.scene.add(key);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(rig.fill, rig.fillI);
    fill.position.set(-env.sunDirection.x, 3, -env.sunDirection.z);
    this.scene.add(fill);

    // Rim from behind — this is what separates a character from the backdrop
    // and is the single biggest "looks professional" lever in a toon render.
    const rim = new THREE.DirectionalLight(rig.rim, rig.rimI);
    rim.position.set(0, 5, -9);
    this.scene.add(rim);

    for (const node of this.doc.nodes) this.addNode(node);
    // Parenting is resolved after every node exists, so order in the file
    // doesn't matter.
    for (const node of this.doc.nodes) {
      if (!node.parentId) continue;
      const child = this.nodes.get(node.id);
      const parent = this.nodes.get(node.parentId);
      if (!child || !parent) continue;
      const anchor = node.parentJoint
        ? parent.character?.joints.get(node.parentJoint) ?? parent.object
        : parent.object;
      anchor.add(child.object);
    }
  }

  private addNode(doc: SceneNode): NodeRuntime {
    const object = new THREE.Group();
    object.name = doc.name;
    object.position.set(...doc.position);
    object.rotation.set(...doc.rotation);
    object.scale.set(...doc.scale);
    object.visible = doc.visible !== false;

    let character: CharacterInstance | null = null;
    let light: THREE.Light | null = null;
    let camera: THREE.PerspectiveCamera | null = null;

    switch (doc.kind) {
      case 'character': {
        character = buildCharacter(doc.assetId, (doc.params ?? {}) as never);
        if (character) object.add(character.root);
        break;
      }
      case 'prop': {
        const prop = buildProp(doc.assetId, (doc.params ?? {}) as never);
        if (prop) object.add(prop);
        break;
      }
      case 'text': {
        const mesh = buildTextMesh(
          String(doc.params?.text ?? 'Hello'),
          {
            size: Number(doc.params?.size ?? 0.6),
            color: Number(doc.params?.color ?? 0xffffff),
            outlineColor: Number(doc.params?.outlineColor ?? 0x39304a),
            align: (doc.params?.align as 'left' | 'center' | 'right') ?? 'center',
            fitWidth: doc.params?.fitWidth === undefined ? undefined : Number(doc.params.fitWidth),
          },
        );
        object.add(mesh);
        break;
      }
      case 'light': {
        const color = Number(doc.params?.color ?? 0xffffff);
        const intensity = Number(doc.params?.intensity ?? 1);
        const type = String(doc.params?.type ?? 'point');
        light = type === 'spot'
          ? new THREE.SpotLight(color, intensity, Number(doc.params?.distance ?? 20), 0.6, 0.4)
          : new THREE.PointLight(color, intensity, Number(doc.params?.distance ?? 15));
        object.add(light);
        break;
      }
      case 'camera': {
        camera = new THREE.PerspectiveCamera(
          Number(doc.params?.fov ?? 38),
          16 / 9,
          0.1,
          200,
        );
        object.add(camera);
        break;
      }
      case 'fx': {
        // Simulations and particle clouds share the `fx` node kind because they
        // are the same thing to a user: something that moves on its own.
        if (doc.assetId.startsWith('sim.')) this.addSimulation(doc, object);
        else this.fx.add(doc.id, doc.assetId, object, (doc.params ?? {}) as never);
        break;
      }
    }

    if (!doc.parentId) this.scene.add(object);

    const rt: NodeRuntime = {
      doc,
      object,
      character,
      light,
      camera,
      basePosition: object.position.clone(),
      baseRotation: object.rotation.clone(),
      baseScale: object.scale.clone(),
      tracks: new Map((doc.tracks ?? []).map((t) => [t.channel, t])),
      expr: {},
      vis: {},
    };
    this.nodes.set(doc.id, rt);
    return rt;
  }

  private addSimulation(doc: SceneNode, parent: THREE.Object3D) {
    const p = (doc.params ?? {}) as Record<string, number | string | boolean>;
    const num = (k: string, fallback: number) => (typeof p[k] === 'number' ? (p[k] as number) : fallback);
    let sim: Simulation | null = null;

    if (doc.assetId === 'sim.cloth') {
      const cloth = buildCloth({
        width: num('width', 1.2),
        height: num('height', 1.0),
        cols: num('cols', 12),
        rows: num('rows', 12),
        color: num('color', 0xff8fb1),
        pin: (p.pin as 'top-corners') ?? 'top-corners',
        wind: new THREE.Vector3(num('windX', 0.6), 0, num('windZ', 0.25)),
        windGust: num('gust', 0.8),
      });
      parent.add(cloth.mesh);
      sim = cloth;
    } else if (doc.assetId === 'sim.rope') {
      const rope = buildRope({
        length: num('length', 1.4),
        segments: num('segments', 12),
        radius: num('radius', 0.02),
        color: num('color', 0xfff8ec),
      });
      parent.add(rope.mesh);
      sim = rope;
    } else if (doc.assetId === 'sim.ball') {
      const ball = buildBouncer({
        radius: num('radius', 0.24),
        color: num('color', 0xf5455c),
        start: new THREE.Vector3(0, num('dropFrom', 2.6), 0),
        velocity: new THREE.Vector3(num('velocityX', 0.8), 0, num('velocityZ', 0)),
        bounce: num('bounce', 0.72),
      });
      parent.add(ball.mesh);
      sim = ball;
    }

    if (sim) this.sims.push(sim);
  }

  /** Point every character's eyes at a world position (usually the camera). */
  setEyeTarget(target: THREE.Vector3 | null) {
    this.lookTarget = target;
  }

  getCamera(cameraNodeId?: string): THREE.PerspectiveCamera {
    if (cameraNodeId) {
      const rt = this.nodes.get(cameraNodeId);
      if (rt?.camera) return rt.camera;
    }
    return this.defaultCamera;
  }

  /**
   * Where a shot should point to put this node's face in frame.
   * Falls back to a point above the origin for props and lights.
   */
  getNodeFocus(nodeId: string, out = new THREE.Vector3()): THREE.Vector3 {
    const rt = this.nodes.get(nodeId);
    if (!rt) return out.set(0, 1, 0);
    const ch = rt.character;
    const head = ch?.joints.get('head') ?? ch?.joints.get('body');
    if (head) {
      head.updateWorldMatrix(true, false);
      head.getWorldPosition(out);
      // The head *joint* sits at the base of the skull; the face is above it.
      // Framing on the joint puts the chin in the middle of a close-up.
      const scale = rt.object.scale.y;
      out.y += (ch!.rigFamily === 'quadruped' || ch!.rigFamily === 'fish' ? 0.06 : 0.22) * scale;
      return out;
    }
    rt.object.getWorldPosition(out);
    out.y += 0.6 * rt.object.scale.y;
    return out;
  }

  private sample(rt: NodeRuntime, channel: string, fallback = 0): number {
    const t = rt.tracks.get(channel);
    return t ? sampleTrack(t, this._t) : fallback;
  }

  private _t = 0;

  update(t: number, dt: number) {
    this._t = t;
    for (const rt of this.nodes.values()) {
      this.updateNode(rt);
    }
    this.fx.update(t, dt);
    for (const sim of this.sims) sim.update(t);
  }

  private updateNode(rt: NodeRuntime) {
    const o = rt.object;
    const t = this._t;

    // --- transform: base + animated offset ---
    o.position.set(
      rt.basePosition.x + this.sample(rt, 'position.x'),
      rt.basePosition.y + this.sample(rt, 'position.y'),
      rt.basePosition.z + this.sample(rt, 'position.z'),
    );
    o.rotation.set(
      rt.baseRotation.x + this.sample(rt, 'rotation.x'),
      rt.baseRotation.y + this.sample(rt, 'rotation.y'),
      rt.baseRotation.z + this.sample(rt, 'rotation.z'),
    );
    // Scale channels are *relative* (0 = unchanged), so squash-and-stretch
    // clips work on a character that's already been scaled in the scene.
    o.scale.set(
      rt.baseScale.x * (1 + this.sample(rt, 'scale.x')),
      rt.baseScale.y * (1 + this.sample(rt, 'scale.y')),
      rt.baseScale.z * (1 + this.sample(rt, 'scale.z')),
    );

    const vis = rt.tracks.get('visible');
    if (vis) o.visible = sampleTrack(vis, t) > 0.5;

    // --- character rig ---
    const ch = rt.character;
    if (ch) {
      for (const [id, joint] of ch.joints) {
        const rest = ch.rest.get(id);
        const rx = this.sample(rt, `rig.${id}.rx`);
        const ry = this.sample(rt, `rig.${id}.ry`);
        const rz = this.sample(rt, `rig.${id}.rz`);
        joint.rotation.set(
          (rest?.x ?? 0) + rx,
          (rest?.y ?? 0) + ry,
          (rest?.z ?? 0) + rz,
        );
      }

      if (ch.face) {
        for (const id of EXPRESSION_IDS) {
          const v = this.sample(rt, `expression.${id}`);
          if (v > 0.001) rt.expr[id] = v;
          else delete rt.expr[id];
        }
        // With no expression keys at all, hold a gentle default rather than a
        // blank stare.
        const pose = Object.keys(rt.expr).length ? blendExpressions(rt.expr) : blendExpressions({ happy: 0.5, neutral: 0.5 });

        for (const id of VISEME_IDS) {
          const v = this.sample(rt, `viseme.${id}`);
          if (v > 0.001) rt.vis[id] = v;
          else delete rt.vis[id];
        }
        const mouth = blendVisemes(rt.vis);
        const blink = this.sample(rt, 'blink');
        ch.face.lookAt(this.lookTarget);
        ch.face.applyPose(pose, mouth, blink);
      }
    }

    // --- lights ---
    if (rt.light) {
      const i = rt.tracks.get('light.intensity');
      if (i) rt.light.intensity = sampleTrack(i, t);
    }

    // --- camera ---
    if (rt.camera) {
      const fov = rt.tracks.get('camera.fov');
      if (fov) {
        rt.camera.fov = sampleTrack(fov, t);
        rt.camera.updateProjectionMatrix();
      }
    }
  }

  /** Track the key light to the action so shadows stay on screen. */
  focusShadowsOn(point: THREE.Vector3) {
    this.keyLight.target.position.copy(point);
    this.keyLight.target.updateMatrixWorld();
    if (!this.keyLight.target.parent) this.scene.add(this.keyLight.target);
  }

  dispose() {
    for (const sim of this.sims) sim.dispose();
    this.sims.length = 0;
    this.fx.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        // Geometry and materials are shared from the caches — they're freed by
        // `disposeCaches()`, not here, or one scene teardown would break others.
      }
    });
    this.scene.clear();
    this.nodes.clear();
  }
}
