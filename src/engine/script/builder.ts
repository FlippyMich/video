/**
 * Script → project.
 *
 * This is the auto-animator. It takes the parsed script and produces a complete,
 * playable project: staged characters, baked performances, lip-sync, a cut
 * camera track, subtitles and audio placeholders.
 *
 * The output is a normal project — every decision made here is a keyframe or a
 * shot the user can then drag, retime or delete. Nothing is locked.
 */

import type {
  AnimTrack, AudioClip, InteractionBeat, Project, SceneDoc, SceneNode,
  Shot, SubtitleCue, Vec3, FramingPreset, CameraMove, LightingPreset, EnvironmentTheme,
} from '../types';
import type { ParsedScene, ParsedScript } from './parser';
import { estimateSpeechDuration } from './parser';
import { bakeAction, mergeTracks, type ActionId } from '../anim/clips';
import { blinkKeys, type ExpressionId } from '../rig/expressions';
import { visemeEventsToTracks, visemesFromPhonemes, visemesFromText, type PhonemeTiming } from '../rig/visemes';
import { simplifyKeys } from '../anim/keyframes';
import { CHARACTER_BY_ID, CHARACTERS } from '../assets/characters';
import type { RigFamily } from '../rig/rig';

export interface CastMember {
  /** Uppercase name as it appears in the script. */
  name: string;
  assetId: string;
  /** Display name for subtitles and the cast list. */
  displayName: string;
  params?: Record<string, unknown>;
  /** Overrides the automatic staging position. */
  position?: Vec3;
}

export interface BuildOptions {
  /** Explicit casting. Anything not listed is guessed from the name. */
  cast?: CastMember[];
  fps?: number;
  width?: number;
  height?: number;
  /** Real recorded timings, keyed by `sceneIndex:beatIndex`. */
  voiceTimings?: Record<string, { duration: number; phonemes?: PhonemeTiming[]; src?: string }>;
  /** Words per minute when no recording exists yet. */
  wpm?: number;
  /** Seconds of silence between lines. */
  beatGap?: number;
  /** Add an animated title card at the top and an outro at the end. */
  bookends?: boolean;
  titleCardText?: string;
  outroText?: string;
}

/* ------------------------------------------------------------------ *
 * Casting
 * ------------------------------------------------------------------ */

const NAME_HINTS: [RegExp, string][] = [
  [/buzz/i, 'char.buzzy'],
  [/\bbee\b/i, 'char.bee'],
  [/lady ?bird|lady ?bug|dotty|spot/i, 'char.ladybird'],
  [/butterfly|flutter/i, 'char.butterfly'],
  [/pup|dog|rex|patch/i, 'char.puppy'],
  [/kitt|cat\b|mittens/i, 'char.kitten'],
  [/bun|rabbit|hop/i, 'char.bunny'],
  [/bird|robin|chirp|tweet/i, 'char.bird'],
  [/frog|hop|ribbit/i, 'char.frog'],
  [/cloud|nimbus|puff/i, 'char.cloud'],
  [/cater|worm|wiggle/i, 'char.caterpillar'],
  [/fish|splash|bubble/i, 'char.fish'],
  [/teacher|miss|mr|mrs|ms\b|grown|mum|mom|dad/i, 'char.adult'],
  [/narrator|voice|announcer/i, 'char.buzzy'],
];

function guessAsset(name: string, index: number): string {
  for (const [re, id] of NAME_HINTS) if (re.test(name)) return id;
  // Fall back to children, so an unrecognised name still becomes someone.
  return index % 2 === 0 ? 'char.kid' : 'char.kid';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function autoCast(script: ParsedScript, provided: CastMember[] = []): CastMember[] {
  const byName = new Map(provided.map((c) => [c.name.toUpperCase(), c]));
  return script.cast.map((name, i) => {
    const hit = byName.get(name);
    if (hit) return { ...hit, name: name.toUpperCase() };
    const assetId = guessAsset(name, i);
    return {
      name,
      assetId,
      displayName: titleCase(name),
      params: assetId === 'char.kid' || assetId === 'char.adult' ? { seed: i * 7 + 3 } : {},
    };
  });
}

/* ------------------------------------------------------------------ *
 * Staging
 * ------------------------------------------------------------------ */

/** Place speakers on a shallow arc facing the camera, host slightly forward. */
function stagePositions(count: number): Vec3[] {
  if (count === 1) return [[0, 0, 0]];
  const spread = Math.min(1.15, 2.6 / count);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * spread * 1.5;
    // Curve the ends toward camera so nobody is hidden behind anybody.
    const z = -Math.abs(x) * 0.28;
    out.push([x, 0, z]);
  }
  return out;
}

/** Flying characters hover; everyone else stands on the floor. */
function restingHeight(family: RigFamily): number {
  return family === 'winged-bug' ? 0.55 : family === 'bird' ? 0.05 : 0;
}

/* ------------------------------------------------------------------ *
 * Builder
 * ------------------------------------------------------------------ */

interface NodeAccum {
  node: SceneNode;
  tracks: AnimTrack[][];
  family: RigFamily;
  index: number;
}

const LIGHTING_FOR_THEME: Record<EnvironmentTheme, LightingPreset> = {
  garden: 'sunny', meadow: 'sunny', forest: 'soft-day', pond: 'soft-day',
  sky: 'sunny', classroom: 'indoor-warm', kitchen: 'indoor-warm',
  bedroom: 'indoor-warm', void: 'stage',
};

export function buildProjectFromScript(script: ParsedScript, options: BuildOptions = {}): Project {
  const fps = options.fps ?? script.fps ?? 30;
  const gap = options.beatGap ?? 0.28;
  const cast = autoCast(script, options.cast);
  const castByName = new Map(cast.map((c) => [c.name, c]));

  const scenes: SceneDoc[] = [];
  const sequence: Shot[] = [];
  const audio: AudioClip[] = [];
  const subtitles: SubtitleCue[] = [];
  const interactions: InteractionBeat[] = [];

  let t = 0;
  let uid = 0;
  const id = (p: string) => `${p}-${(++uid).toString(36)}`;

  /* ---- optional animated title card ---- */
  if (options.bookends !== false) {
    const intro = buildTitleCard(script.title, options.titleCardText ?? 'A Buzzy Bloom Kids story', t, id);
    scenes.push(intro.scene);
    sequence.push(...intro.shots);
    audio.push({
      id: id('aud'), role: 'music', lane: 0, src: 'audio/music/logo-sting.wav',
      start: t, duration: intro.duration, gain: 0.9, fadeOut: 0.4, label: 'Logo sting',
    });
    t += intro.duration;
  }

  /* ---- scenes ---- */
  script.scenes.forEach((parsed, sceneIndex) => {
    const built = buildScene(parsed, sceneIndex, cast, castByName, t, id, options, fps);
    scenes.push(built.scene);
    sequence.push(...built.shots);
    audio.push(...built.audio);
    subtitles.push(...built.subtitles);
    interactions.push(...built.interactions);
    t = built.endTime + gap;
  });

  /* ---- outro ---- */
  if (options.bookends !== false) {
    const outro = buildOutro(options.outroText ?? 'Thanks for watching!', t, id);
    scenes.push(outro.scene);
    sequence.push(...outro.shots);
    audio.push({
      id: id('aud'), role: 'music', lane: 0, src: 'audio/music/outro.wav',
      start: t, duration: outro.duration, gain: 0.85, fadeOut: 1.2, label: 'Outro music',
    });
    t += outro.duration;
  }

  const now = new Date().toISOString();
  return {
    meta: {
      title: script.title,
      subtitle: script.subtitle,
      author: script.author,
      fps,
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      duration: Math.round(t * fps) / fps,
      createdAt: now,
      modifiedAt: now,
      schema: 1,
    },
    scenes,
    sequence,
    audio,
    subtitles,
    interactions,
  };
}

/* ------------------------------------------------------------------ *
 * One scene
 * ------------------------------------------------------------------ */

function buildScene(
  parsed: ParsedScene,
  sceneIndex: number,
  cast: CastMember[],
  castByName: Map<string, CastMember>,
  startTime: number,
  id: (p: string) => string,
  options: BuildOptions,
  fps: number,
) {
  const sceneId = `scene-${sceneIndex + 1}`;
  const gap = options.beatGap ?? 0.28;

  // Who actually appears in this scene? Staging only the present cast keeps
  // the frame uncluttered — a garden scene shouldn't quietly contain the whole
  // classroom.
  const present: CastMember[] = [];
  for (const beat of parsed.beats) {
    const who = beat.speaker ?? beat.subject;
    if (!who) continue;
    const member = castByName.get(who);
    if (member && !present.includes(member)) present.push(member);
  }
  if (!present.length && cast.length) present.push(cast[0]);

  const positions = stagePositions(present.length);
  const accums = new Map<string, NodeAccum>();
  const nodes: SceneNode[] = [];

  present.forEach((member, i) => {
    const def = CHARACTER_BY_ID.get(member.assetId) ?? CHARACTERS[0];
    const family = def.rigFamily;
    const pos: Vec3 = member.position ?? [positions[i][0], restingHeight(family), positions[i][2]];
    const node: SceneNode = {
      id: `${sceneId}:${member.name.toLowerCase().replace(/\W+/g, '-')}`,
      name: member.displayName,
      kind: 'character',
      assetId: member.assetId,
      position: pos,
      // Turn slightly inward so a line-up reads as a group, not a police parade.
      rotation: [0, present.length > 1 ? -Math.sign(pos[0]) * 0.22 : 0, 0],
      scale: [1, 1, 1],
      params: member.params,
      tracks: [],
    };
    nodes.push(node);
    accums.set(member.name, { node, tracks: [], family, index: i });
  });

  const shots: Shot[] = [];
  const audio: AudioClip[] = [];
  const subtitles: SubtitleCue[] = [];
  const interactions: InteractionBeat[] = [];

  let t = startTime;
  let pendingTransition: { type: Shot['transitionIn'] } | null = null;
  let pendingCamera: { framing?: string; target?: string; move?: string } | null = null;
  let dialogueCount = 0;
  let lastSpeaker: string | null = null;
  let musicLane = 0;

  /** The shot currently being extended, so consecutive lines by one speaker
   *  don't produce a cut every two seconds. */
  let openShot: Shot | null = null;

  const closeShot = (endT: number) => {
    if (openShot) {
      openShot.duration = Math.max(0.4, endT - openShot.start);
      openShot = null;
    }
  };

  const pushShot = (
    at: number,
    framing: FramingPreset,
    targetName: string | null,
    move: CameraMove = 'static',
    note?: string,
  ) => {
    closeShot(at);
    const target = targetName ? accums.get(targetName)?.node.id : undefined;
    const shot: Shot = {
      id: id('shot'),
      sceneId,
      start: at,
      duration: 1,
      framing,
      targetNodeId: target,
      move,
      moveAmount: move === 'handheld' ? 0.6 : 1,
      note,
    };
    if (pendingTransition?.type) {
      shot.transitionIn = pendingTransition.type;
      pendingTransition = null;
    }
    shots.push(shot);
    openShot = shot;
    return shot;
  };

  // Open every scene on a wide establishing shot — the audience needs to know
  // where they are before they're asked to look at a face.
  pushShot(t, 'wide', present[0]?.name ?? null, 'push-in', `Establish: ${parsed.name}`);
  const establishDuration = 1.6;
  t += establishDuration;

  parsed.beats.forEach((beat, beatIndex) => {
    switch (beat.type) {
      case 'transition':
        if (beat.transition) pendingTransition = { type: beat.transition };
        break;

      case 'camera':
        pendingCamera = beat.camera ?? null;
        break;

      case 'music':
        audio.push({
          id: id('aud'), role: 'music', lane: musicLane++ % 2,
          src: `audio/music/${slug(beat.sound ?? 'happy')}.wav`,
          start: t, duration: beat.duration ?? 20, gain: 0.5, fadeIn: 0.6, fadeOut: 1.2,
          duckBy: 9, label: beat.sound,
        });
        break;

      case 'sfx':
        audio.push({
          id: id('aud'), role: 'sfx', lane: 0,
          src: `audio/sfx/${slug(beat.sound ?? 'pop')}.wav`,
          start: t, duration: beat.duration ?? 1, gain: 0.8, label: beat.sound,
        });
        break;

      case 'note':
        break;

      case 'action': {
        const who = beat.subject && accums.has(beat.subject) ? beat.subject : lastSpeaker ?? present[0]?.name;
        const acc = who ? accums.get(who) : undefined;
        const actions = (beat.actions ?? []) as ActionId[];
        const duration = beat.duration ?? Math.max(0.8, actions.length * 0.9);
        if (acc && actions.length) {
          actions.forEach((a, i) => {
            acc.tracks.push(bakeAction(a, {
              start: t + i * 0.12,
              duration,
              family: acc.family,
              intensity: 1.1,
              mirror: acc.node.position[0] < 0,
              phase: acc.index * 0.37,
            }));
          });
        }
        if (acc && beat.expression) {
          acc.tracks.push([expressionTrack(beat.expression, t, duration + 0.6)]);
        }
        // An action with no dialogue is a visual beat; give it its own shot.
        if (!openShot || t - openShot.start > 4) {
          pushShot(t, actions.includes('walk') || actions.includes('run') ? 'full' : 'medium', who ?? null, 'static', beat.text);
        }
        t += duration + 0.12;
        break;
      }

      case 'interaction': {
        const spec = beat.interaction!;
        const duration = beat.duration ?? (spec.kind === 'sing-along' ? 6 : 3);
        interactions.push({
          id: id('beat'),
          kind: spec.kind,
          start: t,
          duration,
          prompt: spec.prompt,
          overlay: (spec.overlay as InteractionBeat['overlay']) ??
            (spec.kind === 'sing-along' ? 'bouncing-ball'
              : spec.kind === 'count-along' ? 'countdown'
              : spec.kind === 'copy-the-gesture' ? 'hand-icon'
              : 'answer-pop'),
          answer: spec.answer,
        });
        // Hold on the host, looking right down the lens, and let them react.
        const host = lastSpeaker ?? present[0]?.name ?? null;
        pushShot(t, 'close-up', host, 'static', `Audience beat: ${spec.prompt}`);
        const acc = host ? accums.get(host) : undefined;
        if (acc) {
          acc.tracks.push([expressionTrack('curious', t, duration)]);
          // A little "well?" tilt while waiting, then a delighted reaction.
          acc.tracks.push(bakeAction('nod', { start: t + duration - 0.7, duration: 0.7, family: acc.family, intensity: 0.8 }));
          if (spec.kind === 'copy-the-gesture') {
            acc.tracks.push(bakeAction('wave', { start: t + 0.2, duration: 1.4, family: acc.family, intensity: 1.2 }));
          } else if (spec.kind === 'sing-along') {
            acc.tracks.push(bakeAction('dance', { start: t, duration, family: acc.family, intensity: 1.1 }));
          } else if (spec.kind === 'count-along') {
            acc.tracks.push(bakeAction('point', { start: t + 0.2, duration: 1.1, family: acc.family, intensity: 1.1 }));
          }
        }
        audio.push({
          id: id('aud'), role: 'sfx', lane: 1,
          src: `audio/sfx/${spec.kind === 'question-pause' ? 'think-cue' : 'twinkle'}.wav`,
          start: t, duration: Math.min(2, duration), gain: 0.55, label: spec.kind,
        });
        t += duration;
        break;
      }

      case 'dialogue': {
        const speaker = beat.speaker!;
        const acc = accums.get(speaker);
        const timingKey = `${sceneIndex}:${beatIndex}`;
        const timing = options.voiceTimings?.[timingKey];
        const duration = timing?.duration ?? beat.duration ?? estimateSpeechDuration(beat.text ?? '', options.wpm);

        /* --- camera --- */
        const changedSpeaker = speaker !== lastSpeaker;
        const explicit = pendingCamera;
        pendingCamera = null;
        if (explicit) {
          pushShot(t, (explicit.framing as FramingPreset) ?? 'medium',
            explicit.target ?? speaker, (explicit.move as CameraMove) ?? 'static', beat.text);
        } else if (changedSpeaker || !openShot || t - openShot.start > 6.5) {
          // Vary the framing so a long dialogue scene doesn't flatten out.
          const cycle = dialogueCount % 5;
          const framing: FramingPreset =
            cycle === 0 ? 'medium'
            : cycle === 1 ? 'close-up'
            : cycle === 2 ? (present.length > 1 ? 'two-shot' : 'medium')
            : cycle === 3 ? 'full'
            : 'close-up';
          const move: CameraMove =
            duration > 4 ? 'push-in'
            : cycle === 3 ? 'handheld'
            : 'static';
          pushShot(t, framing, speaker, move, beat.text);
        }

        /* --- performance --- */
        if (acc) {
          const expr: ExpressionId = beat.expression ?? pickExpressionFromText(beat.text ?? '');
          acc.tracks.push([expressionTrack(expr, t - 0.2, duration + 0.5)]);

          // Lip sync: real phoneme timings when a recording exists, estimated
          // from the text otherwise.
          const events = timing?.phonemes?.length
            ? visemesFromPhonemes(timing.phonemes, t)
            : visemesFromText(beat.text ?? '', t, duration);
          acc.tracks.push(
            visemeEventsToTracks(events, { intensity: 0.95 }).map((tr) => ({
              channel: tr.channel,
              keys: simplifyKeys(tr.keys.map((k) => ({ t: k.t, v: k.v })), 0.02),
            })),
          );

          // Gesture: emphasise, don't semaphore. One beat gesture per line at
          // most, and only on lines long enough to carry it.
          const explicitActions = (beat.actions ?? []) as ActionId[];
          const gestures = explicitActions.length
            ? explicitActions
            : duration > 1.6
              ? [pickGesture(beat.text ?? '', dialogueCount, acc.family)]
              : [];
          gestures.forEach((g, i) => {
            const meta = g;
            acc.tracks.push(bakeAction(meta, {
              start: t + 0.15 + i * 0.2,
              duration: Math.min(duration, 2.2),
              family: acc.family,
              intensity: 1.05,
              mirror: acc.node.position[0] < 0,
              phase: acc.index * 0.41,
            }));
          });

          // Everyone else stays alive: idle sway, and a look toward the speaker.
          for (const [name, other] of accums) {
            if (name === speaker) continue;
            other.tracks.push(bakeAction('idle', {
              start: t, duration: duration + gap, family: other.family,
              intensity: 0.7, phase: other.index * 0.53,
            }));
            if (changedSpeaker) {
              const dir = Math.sign((acc.node.position[0] ?? 0) - (other.node.position[0] ?? 0));
              other.tracks.push([{
                channel: 'rig.head.ry',
                keys: [
                  { t: t - 0.15, v: 0, ease: 'easeInOut' },
                  { t: t + 0.25, v: dir * 0.32 },
                  { t: t + duration, v: dir * 0.3, ease: 'easeInOut' },
                  { t: t + duration + 0.4, v: 0 },
                ],
              }]);
            }
          }
        }

        /* --- audio & subtitles --- */
        audio.push({
          id: id('aud'), role: 'dialogue', lane: 0,
          src: timing?.src ?? `audio/vo/${sceneIndex + 1}-${beatIndex + 1}-${slug(speaker)}.wav`,
          start: t, duration, gain: 1, label: `${speaker}: ${truncate(beat.text ?? '', 40)}`,
          speakerNodeId: acc?.node.id,
        });
        subtitles.push(...splitSubtitle(beat.text ?? '', t, duration, castByName.get(speaker)?.displayName, id));

        lastSpeaker = speaker;
        dialogueCount++;
        t += duration + gap;
        break;
      }
    }
  });

  closeShot(t);

  /* ---- bake accumulated tracks onto the nodes ---- */
  const sceneDuration = t - startTime;
  for (const [, acc] of accums) {
    // Baseline life: a slow idle under the whole scene, plus blinking. Without
    // these a character freezes solid between lines and the illusion dies.
    acc.tracks.unshift(bakeAction('idle', {
      start: startTime, duration: sceneDuration, family: acc.family,
      intensity: 0.55, phase: acc.index * 0.61,
    }));
    if (acc.family === 'winged-bug') {
      acc.tracks.unshift(bakeAction('hover', { start: startTime, duration: sceneDuration, family: acc.family, intensity: 0.8, phase: acc.index * 0.3 }));
      acc.tracks.unshift(bakeAction('flap', { start: startTime, duration: sceneDuration, family: acc.family, intensity: 1 }));
    }
    const merged = mergeTracks(...acc.tracks);
    merged.push({
      channel: 'blink',
      keys: blinkKeys(sceneDuration, acc.index + sceneIndex * 3 + 1).map((k) => ({ t: k.t + startTime, v: k.v })),
    });
    acc.node.tracks = merged.map((tr) => ({
      channel: tr.channel,
      keys: tr.keys.length > 600 ? simplifyKeys(tr.keys, 0.006) : tr.keys,
    }));
  }

  const scene: SceneDoc = {
    id: sceneId,
    name: parsed.name,
    environment: {
      theme: parsed.theme,
      seed: parsed.seed,
      density: 0.7,
      timeOfDay: (parsed.timeOfDay as SceneDoc['environment']['timeOfDay']) ?? 'morning',
      weather: (parsed.weather as SceneDoc['environment']['weather']) ?? 'clear',
    },
    nodes,
    lighting: (parsed.lighting as LightingPreset) ?? LIGHTING_FOR_THEME[parsed.theme] ?? 'soft-day',
  };

  // Snap every cut to a frame boundary; a shot that changes mid-frame shows up
  // as a one-frame flash in the export.
  for (const s of shots) {
    s.start = Math.round(s.start * fps) / fps;
    s.duration = Math.max(1 / fps, Math.round(s.duration * fps) / fps);
  }

  return { scene, shots, audio, subtitles, interactions, endTime: t };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function expressionTrack(expr: ExpressionId, start: number, duration: number): AnimTrack {
  return {
    channel: `expression.${expr}`,
    keys: [
      { t: Math.max(0, start - 0.25), v: 0, ease: 'easeInOut' },
      { t: start + 0.1, v: 1 },
      { t: start + duration, v: 1, ease: 'easeInOut' },
      { t: start + duration + 0.35, v: 0 },
    ],
  };
}

const QUESTION_GESTURES: ActionId[] = ['shrug', 'lean-in', 'think'];
const EMPHASIS_GESTURES: ActionId[] = ['present', 'point', 'nod', 'big-wave'];

function pickGesture(text: string, index: number, family: RigFamily): ActionId {
  if (/\?/.test(text)) return QUESTION_GESTURES[index % QUESTION_GESTURES.length];
  if (/!/.test(text)) return family === 'winged-bug' ? 'cheer' : 'cheer';
  if (/\b(look|see|watch|here|this)\b/i.test(text)) return 'point';
  if (/\b(listen|hear|sound)\b/i.test(text)) return 'listen';
  if (/\b(smell|sniff|scent)\b/i.test(text)) return 'sniff';
  if (/\b(taste|eat|yummy|delicious)\b/i.test(text)) return 'taste';
  if (/\b(touch|feel|soft|rough|smooth)\b/i.test(text)) return 'touch-reach';
  return EMPHASIS_GESTURES[index % EMPHASIS_GESTURES.length];
}

function pickExpressionFromText(text: string): ExpressionId {
  if (/[!]{2,}|\bwow\b|\bamazing\b|\bincredible\b/i.test(text)) return 'excited';
  if (/\?/.test(text)) return 'curious';
  if (/\b(oh no|sorry|sad|miss)\b/i.test(text)) return 'sad';
  if (/\b(yuck|eww|sour|bleugh)\b/i.test(text)) return 'yucky';
  if (/\b(hmm|think|wonder|maybe)\b/i.test(text)) return 'thinking';
  if (/!/.test(text)) return 'happy';
  return 'happy';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Split a line into subtitle cues.
 *
 * Broadcast caption practice: at most two lines, ~40 characters each, and never
 * break in the middle of a phrase. Long speeches become several cues timed
 * proportionally to their length.
 */
function splitSubtitle(
  text: string,
  start: number,
  duration: number,
  speaker: string | undefined,
  id: (p: string) => string,
): SubtitleCue[] {
  const MAX = 76;
  if (text.length <= MAX) {
    return [{ id: id('cue'), start, end: start + duration, text: wrapTwoLines(text), speaker }];
  }
  // Prefer sentence boundaries, then commas, then words.
  const chunks: string[] = [];
  let buf = '';
  for (const part of text.split(/(?<=[.!?,])\s+/)) {
    if (!buf) buf = part;
    else if (`${buf} ${part}`.length <= MAX) buf = `${buf} ${part}`;
    else { chunks.push(buf); buf = part; }
  }
  if (buf) chunks.push(buf);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  let at = start;
  return chunks.map((c) => {
    const d = (c.length / total) * duration;
    const cue: SubtitleCue = { id: id('cue'), start: at, end: at + d, text: wrapTwoLines(c), speaker };
    at += d;
    return cue;
  });
}

function wrapTwoLines(text: string): string {
  if (text.length <= 40) return text;
  const words = text.split(' ');
  let a = '';
  let i = 0;
  while (i < words.length && (a + words[i]).length < text.length / 2) {
    a += (a ? ' ' : '') + words[i];
    i++;
  }
  return `${a}\n${words.slice(i).join(' ')}`;
}

/* ------------------------------------------------------------------ *
 * Title card & outro
 * ------------------------------------------------------------------ */

function buildTitleCard(title: string, subtitle: string, start: number, id: (p: string) => string) {
  const duration = 5.5;
  const sceneId = 'scene-title';
  const nodes: SceneNode[] = [
    {
      id: 'title:buzzy', name: 'Buzzy', kind: 'character', assetId: 'char.buzzy',
      position: [0, 0.75, 0.6], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1],
      tracks: mergeTracks(
        bakeAction('flap', { start, duration, family: 'winged-bug' }),
        bakeAction('hover', { start, duration, family: 'winged-bug', intensity: 1 }),
        bakeAction('take-off', { start: start + 0.1, duration: 0.9, family: 'winged-bug', intensity: 0.4 }),
        bakeAction('big-wave', { start: start + 1.1, duration: 2.0, family: 'winged-bug', intensity: 1.2 }),
        bakeAction('spin', { start: start + 3.2, duration: 1.1, family: 'winged-bug', intensity: 1 }),
        [expressionTrack('excited', start + 0.3, duration - 0.6)],
        [{ channel: 'blink', keys: blinkKeys(duration, 5).map((k) => ({ t: k.t + start, v: k.v })) }],
      ),
    },
    {
      id: 'title:text', name: 'Title', kind: 'text', assetId: 'text',
      position: [0, 2.35, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { text: title, size: 0.52, color: 0xfff3c4, outlineColor: 0x5a3a12 },
      tracks: [
        { channel: 'scale.x', keys: [{ t: start + 0.5, v: -0.9, ease: 'bounce' }, { t: start + 1.3, v: 0 }] },
        { channel: 'scale.y', keys: [{ t: start + 0.5, v: -0.9, ease: 'bounce' }, { t: start + 1.35, v: 0 }] },
        { channel: 'rotation.z', keys: [{ t: start + 0.5, v: -0.3, ease: 'easeOut' }, { t: start + 1.4, v: 0 }] },
      ],
    },
    {
      id: 'title:sub', name: 'Subtitle', kind: 'text', assetId: 'text',
      position: [0, 1.72, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { text: subtitle, size: 0.2, color: 0xffffff, outlineColor: 0x5a3a12 },
      tracks: [
        { channel: 'position.y', keys: [{ t: start + 1.4, v: -0.4, ease: 'easeOut' }, { t: start + 2.1, v: 0 }] },
        { channel: 'scale.x', keys: [{ t: start + 1.3, v: -1, ease: 'step' }, { t: start + 1.4, v: 0 }] },
      ],
    },
    {
      id: 'title:sparkles', name: 'Sparkles', kind: 'fx', assetId: 'fx.sparkles',
      position: [0, 1.4, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { count: 120, spread: 5, height: 3.5, size: 0.16 },
    },
    {
      id: 'title:petals', name: 'Petals', kind: 'fx', assetId: 'fx.petals',
      position: [0, 4, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { count: 60, spread: 9 },
    },
  ];

  const scene: SceneDoc = {
    id: sceneId,
    name: 'Title card',
    environment: { theme: 'garden', seed: 101, density: 0.5, timeOfDay: 'morning', weather: 'clear' },
    nodes,
    lighting: 'stage',
  };

  const shots: Shot[] = [
    { id: id('shot'), sceneId, start, duration: 2.6, framing: 'full', targetNodeId: 'title:buzzy', move: 'push-in', note: 'Logo animation in' },
    { id: id('shot'), sceneId, start: start + 2.6, duration: duration - 2.6, framing: 'wide', targetNodeId: 'title:buzzy', move: 'pull-out', transitionIn: { type: 'crossfade', duration: 0.4 }, note: 'Reveal full title' },
  ];
  return { scene, shots, duration };
}

function buildOutro(message: string, start: number, id: (p: string) => string) {
  const duration = 7;
  const sceneId = 'scene-outro';
  const nodes: SceneNode[] = [
    {
      id: 'outro:buzzy', name: 'Buzzy', kind: 'character', assetId: 'char.buzzy',
      position: [0, 0.7, 0.4], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1],
      tracks: mergeTracks(
        bakeAction('flap', { start, duration, family: 'winged-bug' }),
        bakeAction('hover', { start, duration, family: 'winged-bug' }),
        bakeAction('big-wave', { start: start + 0.4, duration: 2.4, family: 'winged-bug', intensity: 1.2 }),
        bakeAction('cheer', { start: start + 3.2, duration: 1.5, family: 'winged-bug', intensity: 1.1 }),
        bakeAction('big-wave', { start: start + 5.0, duration: 1.8, family: 'winged-bug', intensity: 1.1 }),
        [expressionTrack('excited', start, duration)],
        [{ channel: 'blink', keys: blinkKeys(duration, 9).map((k) => ({ t: k.t + start, v: k.v })) }],
      ),
    },
    {
      id: 'outro:text', name: 'Message', kind: 'text', assetId: 'text',
      position: [0, 2.45, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { text: message, size: 0.4, color: 0xfff3c4, outlineColor: 0x5a3a12 },
      tracks: [
        { channel: 'scale.x', keys: [{ t: start + 0.2, v: -0.9, ease: 'bounce' }, { t: start + 1.0, v: 0 }] },
        { channel: 'scale.y', keys: [{ t: start + 0.2, v: -0.9, ease: 'bounce' }, { t: start + 1.05, v: 0 }] },
      ],
    },
    {
      id: 'outro:cta', name: 'Call to action', kind: 'text', assetId: 'text',
      position: [0, 1.75, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { text: 'Subscribe for more stories!', size: 0.22, color: 0xffffff, outlineColor: 0x5a3a12 },
      tracks: [
        { channel: 'scale.x', keys: [{ t: start + 1.5, v: -1, ease: 'step' }, { t: start + 1.6, v: 0.06, ease: 'easeInOut' }, { t: start + 2.2, v: 0 }] },
        { channel: 'scale.y', keys: [{ t: start + 1.5, v: -1, ease: 'step' }, { t: start + 1.6, v: 0.06, ease: 'easeInOut' }, { t: start + 2.2, v: 0 }] },
        // A gentle pulse so the CTA keeps drawing the eye without shouting.
        { channel: 'position.y', keys: [
          { t: start + 2.2, v: 0, ease: 'easeInOut' }, { t: start + 3.0, v: 0.06, ease: 'easeInOut' },
          { t: start + 3.8, v: 0, ease: 'easeInOut' }, { t: start + 4.6, v: 0.06, ease: 'easeInOut' },
          { t: start + 5.4, v: 0 },
        ] },
      ],
    },
    {
      id: 'outro:confetti', name: 'Confetti', kind: 'fx', assetId: 'fx.confetti',
      position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { count: 220, spread: 10, height: 7, burst: false },
    },
    {
      id: 'outro:hearts', name: 'Hearts', kind: 'fx', assetId: 'fx.hearts',
      position: [0, 1.4, 0.5], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: { count: 30, spread: 3, burst: false, lifetime: 3 },
    },
  ];

  const scene: SceneDoc = {
    id: sceneId,
    name: 'Outro',
    environment: { theme: 'garden', seed: 202, density: 0.6, timeOfDay: 'afternoon', weather: 'rainbow' },
    nodes,
    lighting: 'stage',
  };

  const shots: Shot[] = [
    { id: id('shot'), sceneId, start, duration: 3.4, framing: 'full', targetNodeId: 'outro:buzzy', move: 'static', transitionIn: { type: 'crossfade', duration: 0.5 }, note: 'Goodbye wave' },
    { id: id('shot'), sceneId, start: start + 3.4, duration: duration - 3.4, framing: 'wide', targetNodeId: 'outro:buzzy', move: 'pull-out', note: 'End card with call to action' },
  ];
  return { scene, shots, duration };
}
