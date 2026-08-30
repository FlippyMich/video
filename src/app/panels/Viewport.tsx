/**
 * The viewport.
 *
 * Shows the film through the current shot's camera — what you see here is the
 * frame that will be exported, because it comes from the same `Player`.
 *
 * A dedicated "orbit" mode is available for staging: it lets the user fly the
 * camera around the set without disturbing the shot, which is the one thing a
 * locked-off preview can't do.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Player } from '../../engine/render/player';
import { shotAt } from '../../engine/render/director';
import { store } from '../store';
import { useEditor } from '../useEditor';

const SAFE_AREA = 0.05;

export function Viewport() {
  const state = useEditor((s) => ({
    project: s.project,
    time: s.time,
    playing: s.playing,
    sceneRevision: s.sceneRevision,
    dataRevision: s.dataRevision,
    quality: s.quality,
    showCaptions: s.showCaptions,
    showOverlays: s.showOverlays,
    selectedNodeId: s.selectedNodeId,
  }));

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const [orbit, setOrbit] = useState(false);
  const [guides, setGuides] = useState(true);
  const orbitRef = useRef({ yaw: 0.3, pitch: 0.25, dist: 7, target: new THREE.Vector3(0, 1.1, 0) });
  const [fps, setFps] = useState(0);

  /* ---- create the player ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const player = new Player(state.project, {
      // Preview at 720p. The export renders at full size; a 1080p canvas in a
      // panel this size is wasted pixels on a laptop.
      width: 1280,
      height: 720,
      quality: state.quality,
      subtitles: state.showCaptions,
      overlays: state.showOverlays,
    });
    playerRef.current = player;
    player.output.className = 'viewport-canvas';
    host.appendChild(player.output);
    return () => {
      player.dispose();
      player.output.remove();
      playerRef.current = null;
    };
    // Quality and overlay flags change the renderer's construction, so the
    // player is rebuilt rather than patched.
  }, [state.quality, state.showCaptions, state.showOverlays]);

  /* ---- push project changes in ---- */
  useEffect(() => {
    playerRef.current?.setProject(state.project);
  }, [state.project, state.sceneRevision]);

  useEffect(() => {
    // Data-only changes (keyframes, transforms) don't need a rebuild, but the
    // player still holds the old document.
    playerRef.current?.setProject(state.project);
  }, [state.dataRevision]);

  /* ---- draw loop ---- */
  useEffect(() => {
    let last = performance.now();
    let frames = 0;
    let acc = 0;

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const player = playerRef.current;
      if (!player) return;

      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const s = store.getState();
      let t = s.time;
      if (s.playing) {
        t = s.time + dt;
        if (t >= s.project.meta.duration) {
          t = s.project.meta.duration;
          store.set({ time: t, playing: false });
        } else {
          store.set({ time: t });
        }
      }

      if (orbit) drawOrbit(player, t, dt, orbitRef.current);
      else player.render(t, dt);

      lastFrameRef.current = t;
      acc += dt;
      frames++;
      if (acc >= 0.5) {
        setFps(Math.round(frames / acc));
        frames = 0;
        acc = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [orbit]);

  /* ---- orbit controls ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !orbit) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const o = orbitRef.current;
      o.yaw -= (e.clientX - lastX) * 0.006;
      o.pitch = Math.max(-0.4, Math.min(1.2, o.pitch + (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      host.releasePointerCapture?.(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = orbitRef.current;
      o.dist = Math.max(1.2, Math.min(30, o.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    };
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('wheel', wheel, { passive: false });
    return () => {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('wheel', wheel);
    };
  }, [orbit]);

  /* ---- click to select ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const click = (e: MouseEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const canvas = player.output;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const hit = pickNode(player, x, y);
      if (hit) store.set({ selectedNodeId: hit });
    };
    host.addEventListener('click', click);
    return () => host.removeEventListener('click', click);
  }, []);

  /* ---- drop from the asset library ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('application/bloom-asset')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      host.classList.add('drop-active');
    };
    const leave = () => host.classList.remove('drop-active');
    const drop = (e: DragEvent) => {
      host.classList.remove('drop-active');
      const raw = e.dataTransfer?.getData('application/bloom-asset');
      if (!raw) return;
      e.preventDefault();
      const asset = JSON.parse(raw) as { id: string; kind: string; name: string };
      const player = playerRef.current;
      const canvas = player?.output;
      if (!player || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const point = projectToGround(player, nx, ny);
      window.dispatchEvent(new CustomEvent('bloom:drop-asset', {
        detail: { asset, position: [point.x, 0, point.z] },
      }));
    };
    host.addEventListener('dragover', over);
    host.addEventListener('dragleave', leave);
    host.addEventListener('drop', drop);
    return () => {
      host.removeEventListener('dragover', over);
      host.removeEventListener('dragleave', leave);
      host.removeEventListener('drop', drop);
    };
  }, []);

  const hit = shotAt(state.project.sequence, state.time);
  const sceneName = state.project.scenes.find((s) => s.id === hit?.shot.sceneId)?.name;

  return (
    <div className="viewport">
      <div className="viewport-stage" ref={hostRef}>
        {guides && (
          <div className="viewport-guides" aria-hidden>
            <div className="guide-thirds" />
            <div
              className="guide-safe"
              style={{ inset: `${SAFE_AREA * 100}%` }}
              title="Title-safe area"
            />
          </div>
        )}
        <div className="viewport-hud">
          <span className="hud-chip">{sceneName ?? '—'}</span>
          {hit && <span className="hud-chip subtle">Shot {hit.index + 1} · {hit.shot.framing ?? 'camera'}</span>}
          <span className="hud-chip subtle">{fps} fps</span>
        </div>
      </div>

      <div className="viewport-tools">
        <button
          className={orbit ? 'tool on' : 'tool'}
          onClick={() => setOrbit((v) => !v)}
          title="Fly the camera around the set to check your staging. The shot itself is unchanged."
        >
          {orbit ? 'Looking around' : 'Look around'}
        </button>
        <button className={guides ? 'tool on' : 'tool'} onClick={() => setGuides((v) => !v)} title="Rule of thirds and the title-safe area">
          Guides
        </button>
        <label className="tool-check">
          <input
            type="checkbox"
            checked={state.showCaptions}
            onChange={(e) => store.set({ showCaptions: e.target.checked })}
          />
          Captions
        </label>
        <label className="tool-check">
          <input
            type="checkbox"
            checked={state.showOverlays}
            onChange={(e) => store.set({ showOverlays: e.target.checked })}
          />
          Audience cues
        </label>
        <span className="tool-spacer" />
        <label className="tool-check">
          Preview
          <select
            value={state.quality}
            onChange={(e) => store.set({ quality: e.target.value as 'draft' | 'good' | 'best' })}
          >
            <option value="draft">Fast</option>
            <option value="good">Normal</option>
            <option value="best">Best</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Picking and orbiting
 *
 * Both need the camera the player just used, which the player exposes through
 * its renderer. Rather than duplicate the framing maths we re-render with a
 * camera we control.
 * ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function currentCamera(player: Player): THREE.PerspectiveCamera | null {
  // The player's render camera is private; reading it back from the last
  // rendered state keeps picking honest — we hit-test exactly what's on screen.
  const cam = (player as unknown as { renderCamera: THREE.PerspectiveCamera }).renderCamera;
  return cam ?? null;
}

function pickNode(player: Player, x: number, y: number): string | null {
  const state = store.getState();
  const hit = shotAt(state.project.sequence, player.currentTime);
  if (!hit) return null;
  const runtime = player.getRuntime(hit.shot.sceneId);
  const camera = currentCamera(player);
  if (!runtime || !camera) return null;

  pointer.set(x, y);
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(runtime.scene, true);
  for (const i of intersects) {
    // Walk up to whichever ancestor is a node root.
    let o: THREE.Object3D | null = i.object;
    while (o) {
      for (const [id, node] of runtime.nodes) {
        if (node.object === o) return id;
      }
      o = o.parent;
    }
  }
  return null;
}

function projectToGround(player: Player, x: number, y: number): THREE.Vector3 {
  const camera = currentCamera(player);
  const out = new THREE.Vector3(0, 0, 0);
  if (!camera) return out;
  pointer.set(x, y);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, out)) {
    // Looking at the sky: drop it a sensible distance in front of the camera.
    raycaster.ray.at(6, out);
    out.y = 0;
  }
  out.x = Math.max(-14, Math.min(14, out.x));
  out.z = Math.max(-14, Math.min(14, out.z));
  return out;
}

function drawOrbit(
  player: Player,
  t: number,
  dt: number,
  o: { yaw: number; pitch: number; dist: number; target: THREE.Vector3 },
) {
  const state = store.getState();
  const hit = shotAt(state.project.sequence, t);
  if (!hit) return;
  const runtime = player.getRuntime(hit.shot.sceneId);
  const camera = currentCamera(player);
  if (!runtime || !camera) return;

  runtime.update(t, dt);
  const cos = Math.cos(o.pitch);
  camera.position.set(
    o.target.x + Math.sin(o.yaw) * cos * o.dist,
    o.target.y + Math.sin(o.pitch) * o.dist,
    o.target.z + Math.cos(o.yaw) * cos * o.dist,
  );
  camera.lookAt(o.target);
  camera.fov = 42;
  camera.updateProjectionMatrix();
  runtime.setEyeTarget(null);
  runtime.focusShadowsOn(o.target);
  player.renderer.render(runtime.scene, camera);

  const ctx = player.output.getContext('2d');
  if (ctx) {
    ctx.drawImage(player.renderer.domElement, 0, 0, player.output.width, player.output.height);
    ctx.save();
    ctx.fillStyle = 'rgba(58,51,64,0.72)';
    ctx.fillRect(0, 0, player.output.width, 46);
    ctx.fillStyle = '#fff';
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Looking around — the shot is not being changed', 18, 31);
    ctx.restore();
  }
}
