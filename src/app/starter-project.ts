/**
 * The project a new user lands in.
 *
 * Not an empty stage. An empty 3D editor is the point at which most people give
 * up, so BloomStudio opens on a small finished scene: two characters, a set, a
 * shot, a line of dialogue with lip-sync, and an audience beat. Everything the
 * app can do is already visible and can be poked at.
 */

import type { Project } from '../engine/types';
import { bakeAction, mergeTracks } from '../engine/anim/clips';
import { blinkKeys } from '../engine/rig/expressions';
import { visemeEventsToTracks, visemesFromText } from '../engine/rig/visemes';

export const TEMPLATES: { id: string; name: string; description: string; build: () => Project }[] = [
  {
    id: 'hello-garden',
    name: 'Hello from the garden',
    description: 'Buzzy and a child in the flower garden. A greeting, a wave and a question for the audience.',
    build: () => createStarterProject(),
  },
  {
    id: 'blank-garden',
    name: 'Empty garden',
    description: 'Just the set, with one character. Start writing your own scene.',
    build: () => createBlankProject('garden'),
  },
  {
    id: 'blank-classroom',
    name: 'Empty classroom',
    description: 'Desks, chairs and a chalkboard, ready for a lesson.',
    build: () => createBlankProject('classroom'),
  },
  {
    id: 'blank-stage',
    name: 'Plain stage',
    description: 'A neutral pastel backdrop. Good for titles and testing a character.',
    build: () => createBlankProject('void'),
  },
];

function meta(title: string, duration: number): Project['meta'] {
  const now = new Date().toISOString();
  return {
    title,
    fps: 30,
    width: 1920,
    height: 1080,
    duration,
    createdAt: now,
    modifiedAt: now,
    schema: 1,
  };
}

export function createStarterProject(): Project {
  const line = "Hello! I'm Buzzy. Welcome to the garden!";
  const lineStart = 1.2;
  const lineDuration = 2.9;

  const buzzyTracks = mergeTracks(
    bakeAction('flap', { start: 0, duration: 12, family: 'winged-bug' }),
    bakeAction('hover', { start: 0, duration: 12, family: 'winged-bug', intensity: 0.9 }),
    bakeAction('big-wave', { start: 0.3, duration: 1.8, family: 'winged-bug', intensity: 1.15 }),
    bakeAction('present', { start: 3.4, duration: 1.4, family: 'winged-bug' }),
    visemeEventsToTracks(visemesFromText(line, lineStart, lineDuration)),
    [
      {
        channel: 'expression.excited',
        keys: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }, { t: 5, v: 1 }, { t: 5.6, v: 0 }],
      },
      { channel: 'blink', keys: blinkKeys(12, 4) },
    ],
  );

  const lilyTracks = mergeTracks(
    bakeAction('idle', { start: 0, duration: 12, family: 'biped', intensity: 0.8 }),
    bakeAction('wave', { start: 1.6, duration: 1.5, family: 'biped', mirror: true }),
    bakeAction('nod', { start: 4.4, duration: 0.9, family: 'biped' }),
    [
      {
        channel: 'expression.happy',
        keys: [{ t: 0, v: 1 }, { t: 12, v: 1 }],
      },
      { channel: 'blink', keys: blinkKeys(12, 9) },
      {
        channel: 'rig.head.ry',
        keys: [
          { t: 0.8, v: 0, ease: 'easeInOut' }, { t: 1.4, v: 0.3 },
          { t: 4.6, v: 0.28, ease: 'easeInOut' }, { t: 5.2, v: 0 },
        ],
      },
    ],
  );

  return {
    meta: meta('My first BloomStudio film', 12),
    scenes: [
      {
        id: 'scene-1',
        name: 'The garden',
        environment: { theme: 'garden', seed: 7, density: 0.65, timeOfDay: 'morning', weather: 'clear' },
        lighting: 'sunny',
        nodes: [
          {
            id: 'buzzy', name: 'Buzzy', kind: 'character', assetId: 'char.buzzy',
            position: [-0.85, 0.6, 0.2], rotation: [0, 0.25, 0], scale: [1, 1, 1],
            tracks: buzzyTracks,
          },
          {
            id: 'lily', name: 'Lily', kind: 'character', assetId: 'char.kid',
            position: [0.95, 0, -0.15], rotation: [0, -0.3, 0], scale: [1, 1, 1],
            params: { seed: 3, hairStyle: 'bunches' },
            tracks: lilyTracks,
          },
          {
            id: 'sunflower', name: 'Sunflower', kind: 'prop', assetId: 'prop.sunflower',
            position: [2.3, 0, -0.9], rotation: [0, 0.4, 0], scale: [1, 1, 1],
          },
          {
            id: 'sparkles', name: 'Sparkles', kind: 'fx', assetId: 'fx.sparkles',
            position: [0, 1.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            params: { count: 60, spread: 3.2, height: 2.4 },
          },
        ],
      },
    ],
    sequence: [
      {
        id: 'shot-1', sceneId: 'scene-1', start: 0, duration: 4.2,
        framing: 'two-shot', targetNodeId: 'buzzy', move: 'push-in',
        note: 'Buzzy waves hello',
      },
      {
        id: 'shot-2', sceneId: 'scene-1', start: 4.2, duration: 3.6,
        framing: 'close-up', targetNodeId: 'buzzy', move: 'static',
        transitionIn: { type: 'crossfade', duration: 0.4 },
        note: 'Close on Buzzy for the question',
      },
      {
        id: 'shot-3', sceneId: 'scene-1', start: 7.8, duration: 4.2,
        framing: 'wide', targetNodeId: 'lily', move: 'pull-out',
        transitionIn: { type: 'crossfade', duration: 0.5 },
        note: 'Pull back to show the garden',
      },
    ],
    audio: [],
    subtitles: [
      { id: 'cue-1', start: lineStart, end: lineStart + lineDuration, text: line, speaker: 'Buzzy' },
    ],
    interactions: [
      {
        id: 'beat-1', kind: 'copy-the-gesture', start: 5.0, duration: 2.6,
        prompt: 'Can you wave back?', overlay: 'hand-icon',
      },
    ],
  };
}

export function createBlankProject(theme: 'garden' | 'classroom' | 'void'): Project {
  const name = theme === 'classroom' ? 'The classroom' : theme === 'void' ? 'The stage' : 'The garden';
  return {
    meta: meta('Untitled film', 8),
    scenes: [
      {
        id: 'scene-1',
        name,
        environment: {
          theme, seed: 12, density: 0.6,
          timeOfDay: theme === 'garden' ? 'morning' : 'noon',
          weather: 'clear',
        },
        lighting: theme === 'garden' ? 'sunny' : theme === 'void' ? 'stage' : 'indoor-warm',
        nodes: [
          {
            id: 'buzzy', name: 'Buzzy', kind: 'character', assetId: 'char.buzzy',
            position: [0, 0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
            tracks: mergeTracks(
              bakeAction('flap', { start: 0, duration: 8, family: 'winged-bug' }),
              bakeAction('hover', { start: 0, duration: 8, family: 'winged-bug' }),
              [{ channel: 'blink', keys: blinkKeys(8, 2) }],
            ),
          },
        ],
      },
    ],
    sequence: [
      {
        id: 'shot-1', sceneId: 'scene-1', start: 0, duration: 8,
        framing: 'medium', targetNodeId: 'buzzy', move: 'static',
        note: 'Opening shot',
      },
    ],
    audio: [],
    subtitles: [],
    interactions: [],
  };
}
