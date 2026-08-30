/**
 * Text in the 3D scene — titles, signposts, number pop-ups, the logo wordmark.
 *
 * Text is drawn to a canvas and mapped onto a plane rather than extruded from a
 * font file. That keeps the whole studio free of binary assets, renders any
 * language the browser can shape (including scripts a triangulated font mesh
 * would mangle), and stays sharp because we size the canvas from the requested
 * world size.
 *
 * The 3D-ness comes from a stack of offset copies behind the face — the same
 * trick a title designer uses in 2D, and it reads better on a cartoon than a
 * real bevel does.
 */

import * as THREE from 'three';

export interface TextOptions {
  /** Cap height in world units. */
  size?: number;
  color?: number;
  outlineColor?: number;
  /** Outline thickness as a fraction of cap height. */
  outlineWidth?: number;
  /** Depth of the offset-copy stack, in world units. 0 for flat text. */
  depth?: number;
  depthColor?: number;
  align?: 'left' | 'center' | 'right';
  fontWeight?: number;
  /** Extra letter spacing, in ems. Kids' titles want a little air. */
  tracking?: number;
  /**
   * Maximum width in world units. The mesh is scaled down to fit rather than
   * re-laid-out, so a long title shrinks instead of running off the screen —
   * which is what actually happens to titles nobody measured.
   */
  fitWidth?: number;
  maxWidth?: number;
}

const FONT_STACK = `"Baloo 2", "Nunito", "Quicksand", "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;

/** Pixels per world unit. High enough that a title fills 1080p without blurring. */
const PIXELS_PER_UNIT = 220;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

interface RenderedText {
  texture: THREE.CanvasTexture;
  /** Plane size in world units. */
  width: number;
  height: number;
}

type LayoutOptions = Required<Omit<TextOptions, 'maxWidth' | 'fitWidth'>> & {
  maxWidth?: number;
};

function renderToCanvas(text: string, o: LayoutOptions): RenderedText {
  const lines = text.split('\n');
  const fontPx = Math.max(8, Math.round(o.size * PIXELS_PER_UNIT));
  const lineHeight = fontPx * 1.24;
  const pad = Math.ceil(fontPx * (o.outlineWidth * 2 + 0.35));

  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `${o.fontWeight} ${fontPx}px ${FONT_STACK}`;
  const trackPx = o.tracking * fontPx;
  const lineWidths = lines.map((l) => measure.measureText(l).width + trackPx * Math.max(0, l.length - 1));
  const textW = Math.max(1, ...lineWidths);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(lineHeight * lines.length + pad * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${o.fontWeight} ${fontPx}px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const drawLine = (line: string, x: number, y: number, stroke: boolean) => {
    if (!o.tracking) {
      if (stroke) ctx.strokeText(line, x, y);
      else ctx.fillText(line, x, y);
      return;
    }
    let cx = x;
    for (const ch of line) {
      if (stroke) ctx.strokeText(ch, cx, y);
      else ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + trackPx;
    }
  };

  lines.forEach((line, i) => {
    const w = lineWidths[i];
    const x = o.align === 'left' ? pad : o.align === 'right' ? canvas.width - pad - w : (canvas.width - w) / 2;
    const y = pad + lineHeight * (i + 0.5);
    if (o.outlineWidth > 0) {
      ctx.strokeStyle = hex(o.outlineColor);
      ctx.lineWidth = fontPx * o.outlineWidth * 2;
      drawLine(line, x, y, true);
    }
    ctx.fillStyle = hex(o.color);
    drawLine(line, x, y, false);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return {
    texture,
    width: canvas.width / PIXELS_PER_UNIT,
    height: canvas.height / PIXELS_PER_UNIT,
  };
}

export function buildTextMesh(text: string, options: TextOptions = {}): THREE.Object3D {
  const o = {
    size: options.size ?? 0.6,
    color: options.color ?? 0xffffff,
    outlineColor: options.outlineColor ?? 0x39304a,
    outlineWidth: options.outlineWidth ?? 0.09,
    depth: options.depth ?? 0.06,
    depthColor: options.depthColor ?? 0x39304a,
    align: options.align ?? 'center',
    fontWeight: options.fontWeight ?? 800,
    tracking: options.tracking ?? 0.02,
    maxWidth: options.maxWidth,
  };
  const fitWidth = options.fitWidth;

  const group = new THREE.Group();
  group.name = 'text';

  const { texture, width, height } = renderToCanvas(text, o);
  const plane = new THREE.PlaneGeometry(width, height);

  // Offset copies behind the face give the letters visible thickness.
  if (o.depth > 0) {
    const layers = Math.max(2, Math.round(o.depth / 0.012));
    const backMat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, color: o.depthColor,
      depthWrite: false, alphaTest: 0.35,
    });
    for (let i = layers; i > 0; i--) {
      const m = new THREE.Mesh(plane, backMat);
      m.position.z = -(i / layers) * o.depth;
      group.add(m);
    }
  }

  const face = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, alphaTest: 0.06,
  }));
  face.renderOrder = 1;
  group.add(face);

  if (fitWidth && width > fitWidth) {
    group.scale.setScalar(fitWidth / width);
  }
  group.userData.textWidth = width;
  group.userData.textHeight = height;
  group.userData.dispose = () => texture.dispose();
  return group;
}

/**
 * A speech/thought bubble with text inside. Used for on-screen prompts during
 * the interactive beats.
 */
export function buildSpeechBubble(
  text: string,
  opts: { color?: number; textColor?: number; tail?: boolean; size?: number } = {},
): THREE.Object3D {
  const g = new THREE.Group();
  const label = buildTextMesh(text, {
    size: opts.size ?? 0.22,
    color: opts.textColor ?? 0x3a3340,
    outlineColor: 0xffffff,
    outlineWidth: 0.05,
    depth: 0,
  });
  const w = (label.userData.textWidth as number) + 0.34;
  const h = (label.userData.textHeight as number) + 0.22;

  const bodyShape = new THREE.Shape();
  const r = Math.min(w, h) * 0.34;
  const x = -w / 2, y = -h / 2;
  bodyShape.moveTo(x + r, y);
  bodyShape.lineTo(x + w - r, y);
  bodyShape.quadraticCurveTo(x + w, y, x + w, y + r);
  bodyShape.lineTo(x + w, y + h - r);
  bodyShape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  bodyShape.lineTo(x + r, y + h);
  bodyShape.quadraticCurveTo(x, y + h, x, y + h - r);
  bodyShape.lineTo(x, y + r);
  bodyShape.quadraticCurveTo(x, y, x + r, y);

  const body = new THREE.Mesh(
    new THREE.ShapeGeometry(bodyShape),
    new THREE.MeshBasicMaterial({ color: opts.color ?? 0xfffdf6 }),
  );
  body.position.z = -0.02;
  const border = new THREE.Mesh(
    new THREE.ShapeGeometry(bodyShape),
    new THREE.MeshBasicMaterial({ color: 0x39304a }),
  );
  border.scale.setScalar(1.05);
  border.position.z = -0.03;
  g.add(border, body, label);

  if (opts.tail !== false) {
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.24, 3),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xfffdf6 }),
    );
    tail.rotation.z = Math.PI;
    tail.rotation.y = Math.PI / 6;
    tail.position.set(-w * 0.18, -h / 2 - 0.08, -0.02);
    g.add(tail);
  }
  return g;
}
