/**
 * The BloomStudio project document.
 *
 * Everything the editor knows about a video lives in one plain-JSON `Project`.
 * No binary blobs: characters, props and sets are *recipes* (an asset id plus a
 * few parameters) that the asset library rebuilds procedurally, and audio is
 * referenced by URL. That keeps a whole 8-minute film in a file small enough to
 * email, diff in git, and hand to the headless renderer.
 */

export type Vec3 = [number, number, number];

export interface ProjectMeta {
  title: string;
  subtitle?: string;
  author?: string;
  /** Frames per second for playback, export and keyframe snapping. */
  fps: number;
  width: number;
  height: number;
  /** Total length in seconds. Derived from the sequence, cached here for the UI. */
  duration: number;
  createdAt: string;
  modifiedAt: string;
  /** Schema version, so old projects can be migrated rather than rejected. */
  schema: 1;
}

/* ------------------------------------------------------------------ *
 * Animation
 * ------------------------------------------------------------------ */

export type Easing =
  | 'linear'
  | 'step'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  /** Overshoots and settles — the squashy feel that reads as "cartoon". */
  | 'bounce'
  | 'elastic';

export interface Keyframe {
  /** Seconds from the start of the project. */
  t: number;
  v: number;
  /** Easing applied on the way *out* of this key, toward the next one. */
  ease?: Easing;
}

/**
 * A channel is a dotted path into an animatable property of a node:
 *   `position.x`, `rotation.y`, `scale.x`
 *   `rig.<jointId>.rx|ry|rz`        — joint rotation in radians
 *   `viseme.<VisemeId>`             — mouth shape weight, 0..1
 *   `expression.<ExpressionId>`     — face pose weight, 0..1
 *   `light.intensity`, `light.color`
 *   `opacity`, `fx.rate`
 */
export interface AnimTrack {
  channel: string;
  keys: Keyframe[];
  /** Muted tracks are kept but not evaluated — handy for A/B-ing a performance. */
  muted?: boolean;
}

/* ------------------------------------------------------------------ *
 * Scene graph
 * ------------------------------------------------------------------ */

export type NodeKind = 'character' | 'prop' | 'light' | 'camera' | 'fx' | 'text';

export interface SceneNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Key into the asset registry, e.g. `char.buzzy` or `prop.flower`. */
  assetId: string;
  position: Vec3;
  /** Euler XYZ in radians. */
  rotation: Vec3;
  scale: Vec3;
  visible?: boolean;
  /** Asset-specific knobs: palette overrides, light colour, text content… */
  params?: Record<string, unknown>;
  tracks?: AnimTrack[];
  /** Optional parent node id — lets a prop ride in a character's hand. */
  parentId?: string;
  /** When parented, which rig joint to follow. */
  parentJoint?: string;
}

export type EnvironmentTheme =
  | 'garden'
  | 'forest'
  | 'sky'
  | 'classroom'
  | 'meadow'
  | 'kitchen'
  | 'bedroom'
  | 'pond'
  | 'void';

export interface EnvironmentSpec {
  theme: EnvironmentTheme;
  /** Same seed ⇒ same set, every time, on every machine. */
  seed: number;
  /** 0..1 — how much clutter the generator scatters around. */
  density?: number;
  timeOfDay?: 'morning' | 'noon' | 'afternoon' | 'sunset' | 'night';
  weather?: 'clear' | 'cloudy' | 'rainbow' | 'petals' | 'snow';
  /** Replaces the sky/backdrop with flat chroma green for keying. */
  chromaKey?: boolean;
}

export interface SceneDoc {
  id: string;
  name: string;
  environment: EnvironmentSpec;
  nodes: SceneNode[];
  /** Overall light rig preset; individual lights can still be added as nodes. */
  lighting: LightingPreset;
}

export type LightingPreset =
  | 'soft-day'
  | 'sunny'
  | 'golden-hour'
  | 'indoor-warm'
  | 'night-moon'
  | 'stage'
  | 'flat-key';

/* ------------------------------------------------------------------ *
 * Sequence (the video timeline)
 * ------------------------------------------------------------------ */

export type TransitionType =
  | 'cut'
  | 'crossfade'
  | 'fade-to-black'
  | 'fade-to-white'
  | 'wipe-left'
  | 'iris'
  | 'whip-pan';

export type FramingPreset =
  | 'wide'
  | 'full'
  | 'medium'
  | 'close-up'
  | 'extreme-close-up'
  | 'over-shoulder'
  | 'low-angle'
  | 'high-angle'
  | 'two-shot';

export type CameraMove =
  | 'static'
  | 'push-in'
  | 'pull-out'
  | 'pan-left'
  | 'pan-right'
  | 'orbit'
  | 'crane-up'
  | 'handheld'
  | 'follow';

export interface Shot {
  id: string;
  sceneId: string;
  /** Start time on the master timeline, in seconds. */
  start: number;
  duration: number;
  /**
   * Either point at a camera node in the scene, or let the shot compose itself
   * from a framing preset aimed at `targetNodeId`. The preset path is what the
   * script importer uses — it means a user never has to place a camera by hand.
   */
  cameraId?: string;
  framing?: FramingPreset;
  targetNodeId?: string;
  move?: CameraMove;
  /** 0..1 strength for the camera move. */
  moveAmount?: number;
  transitionIn?: { type: TransitionType; duration: number };
  effects?: ShotEffect[];
  /** Free-text director's note, shown in the shot list. */
  note?: string;
}

export type ShotEffectType =
  | 'vignette'
  | 'bloom-boost'
  | 'saturate'
  | 'desaturate'
  | 'warm'
  | 'cool'
  | 'zoom-punch'
  | 'shake'
  | 'sparkle-overlay'
  | 'radial-blur';

export interface ShotEffect {
  type: ShotEffectType;
  amount: number;
  start?: number;
  duration?: number;
}

/* ------------------------------------------------------------------ *
 * Audio & captions
 * ------------------------------------------------------------------ */

export type AudioRole = 'dialogue' | 'music' | 'sfx' | 'ambience';

export interface AudioClip {
  id: string;
  role: AudioRole;
  /** Track lane index within its role group. */
  lane: number;
  /** URL or blob-relative path to the audio file. */
  src: string;
  start: number;
  duration: number;
  /** Trim from the head of the source file. */
  offset?: number;
  gain: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Duck this clip under dialogue by this many dB. */
  duckBy?: number;
  label?: string;
  /** Which character speaks it — drives automatic lip-sync assignment. */
  speakerNodeId?: string;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

/* ------------------------------------------------------------------ *
 * Interaction beats — the thing that makes a kids' video a kids' video
 * ------------------------------------------------------------------ */

export type InteractionKind =
  | 'question-pause'
  | 'sing-along'
  | 'copy-the-gesture'
  | 'count-along'
  | 'shout-it-out';

export interface InteractionBeat {
  id: string;
  kind: InteractionKind;
  start: number;
  duration: number;
  prompt: string;
  /** On-screen helper, e.g. a bouncing ball or a countdown ring. */
  overlay?: 'none' | 'bouncing-ball' | 'countdown' | 'hand-icon' | 'answer-pop';
  answer?: string;
}

/* ------------------------------------------------------------------ *
 * Project root
 * ------------------------------------------------------------------ */

export interface Project {
  meta: ProjectMeta;
  scenes: SceneDoc[];
  sequence: Shot[];
  audio: AudioClip[];
  subtitles: SubtitleCue[];
  interactions: InteractionBeat[];
  /** Original imported script, kept so the user can re-run the auto-animator. */
  scriptSource?: string;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate in bits per second. */
  bitrate: number;
  note: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'youtube-1080p',
    label: 'YouTube — 1080p (16:9)',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 12_000_000,
    note: 'The standard upload. Best all-round choice for a full episode.',
  },
  {
    id: 'youtube-4k',
    label: 'YouTube — 4K (16:9)',
    width: 3840,
    height: 2160,
    fps: 30,
    bitrate: 45_000_000,
    note: 'Slower to render, but YouTube gives 4K uploads a better encoder.',
  },
  {
    id: 'youtube-720p',
    label: 'YouTube — 720p (16:9)',
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 6_000_000,
    note: 'Fast draft render for checking timing before the final pass.',
  },
  {
    id: 'shorts',
    label: 'Shorts / Reels / TikTok (9:16)',
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: 10_000_000,
    note: 'Vertical. Cameras auto-reframe to keep faces in the safe area.',
  },
  {
    id: 'square',
    label: 'Instagram / Facebook feed (1:1)',
    width: 1080,
    height: 1080,
    fps: 30,
    bitrate: 8_000_000,
    note: 'Square crop for in-feed posts.',
  },
  {
    id: 'greenscreen-1080p',
    label: 'Green screen — 1080p (16:9)',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 16_000_000,
    note: 'Characters on flat chroma green, no set. Higher bitrate for clean keying.',
  },
];
