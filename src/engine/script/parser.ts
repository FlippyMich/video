/**
 * Script parser.
 *
 * The format is deliberately closer to a rehearsal script than to a file
 * format: a teacher should be able to type it in Notepad, and a screenwriter
 * should be able to paste in something Fountain-ish and have it mostly work.
 *
 * Everything is optional except the dialogue lines. A script that is nothing
 * but `BUZZY: Hello!` over and over still produces a watchable video — the
 * builder fills in cameras, staging and reactions.
 *
 *   # Title: Buzzy's Sense-ational Adventure!
 *   # Fps: 30
 *
 *   ## Scene: The Garden | theme=garden time=morning seed=7
 *
 *   [Buzzy flies in and waves]
 *   BUZZY (excited, wave): Hello, friends! It's me, Buzzy!
 *   @sfx: sparkle
 *   @music: theme
 *   @cam: close-up on BUZZY, push-in
 *   ?? Can you wave back?  | 2.5s | hand-icon
 *   ~~ crossfade 0.6
 */

import type { EnvironmentTheme, InteractionKind, TransitionType } from '../types';
import type { ActionId } from '../anim/clips';
import { ACTION_BY_ID } from '../anim/clips';
import type { ExpressionId } from '../rig/expressions';
import { EXPRESSIONS } from '../rig/expressions';

export type BeatType = 'dialogue' | 'action' | 'sfx' | 'music' | 'camera' | 'interaction' | 'transition' | 'note';

export interface ParsedBeat {
  type: BeatType;
  /** Source line number, so errors and the timeline can point back at the script. */
  line: number;
  speaker?: string;
  text?: string;
  expression?: ExpressionId;
  actions?: ActionId[];
  /** For `action` beats: who is doing it, if the parser could tell. */
  subject?: string;
  sound?: string;
  /** Explicit duration override, in seconds. */
  duration?: number;
  camera?: { framing?: string; target?: string; move?: string };
  interaction?: { kind: InteractionKind; prompt: string; overlay?: string; answer?: string };
  transition?: { type: TransitionType; duration: number };
}

export interface ParsedScene {
  name: string;
  theme: EnvironmentTheme;
  timeOfDay?: string;
  weather?: string;
  seed: number;
  lighting?: string;
  beats: ParsedBeat[];
  line: number;
}

export interface ParsedScript {
  title: string;
  subtitle?: string;
  author?: string;
  fps: number;
  /** Characters discovered in the script, in order of first appearance. */
  cast: string[];
  scenes: ParsedScene[];
  warnings: { line: number; message: string }[];
}

const THEME_WORDS: Record<string, EnvironmentTheme> = {
  garden: 'garden', flowerbed: 'garden', flowers: 'garden',
  forest: 'forest', wood: 'forest', woods: 'forest', trees: 'forest',
  sky: 'sky', clouds: 'sky', air: 'sky',
  classroom: 'classroom', school: 'classroom', class: 'classroom',
  meadow: 'meadow', field: 'meadow', grass: 'meadow',
  kitchen: 'kitchen',
  bedroom: 'bedroom', bed: 'bedroom',
  pond: 'pond', water: 'pond', lake: 'pond',
  void: 'void', stage: 'void', title: 'void', blank: 'void',
};

/** Words in a stage direction that map onto an action clip. */
const ACTION_WORDS: [RegExp, ActionId][] = [
  [/\b(waves?|waving|hello|hi there)\b/i, 'wave'],
  [/\b(big wave|waves? with both)\b/i, 'big-wave'],
  [/\b(points?|pointing)\b/i, 'point'],
  [/\b(presents?|shows?|ta-?da|reveals?)\b/i, 'present'],
  [/\b(claps?|clapping|applau)/i, 'clap'],
  [/\b(cheers?|cheering|hooray|yay)\b/i, 'cheer'],
  [/\b(dances?|dancing|groov)/i, 'dance'],
  [/\b(spins?|spinning|twirls?|whirl)/i, 'spin'],
  [/\b(nods?|nodding|agrees?)\b/i, 'nod'],
  [/\b(shakes? (his|her|their|its)? ?head|disagrees?)\b/i, 'shake-head'],
  [/\b(thinks?|thinking|ponders?|wonders?)\b/i, 'think'],
  [/\b(shrugs?|shrugging)\b/i, 'shrug'],
  [/\b(leans? in|leans? forward|comes? closer)\b/i, 'lean-in'],
  [/\b(looks? around|searches?|scans?)\b/i, 'look-around'],
  [/\b(sniffs?|smells?|breathes? in|inhales?)\b/i, 'sniff'],
  [/\b(listens?|cups? (his|her|their) ear|hears?)\b/i, 'listen'],
  [/\b(tastes?|nibbles?|bites?|eats?|licks?)\b/i, 'taste'],
  [/\b(touch(es)?|reach(es)?|feels?|strokes?|pats?)\b/i, 'touch-reach'],
  [/\b(jumps?|leaps?)\b/i, 'jump'],
  [/\b(hops?|hopping|bounc)/i, 'hop'],
  [/\b(runs?|running|dashes?|hurries)\b/i, 'run'],
  [/\b(walks?|walking|strolls?|wanders?)\b/i, 'walk'],
  [/\b(flies|flying|flits?|zooms?|buzzes)\b/i, 'fly-forward'],
  [/\b(hovers?|floats?|hangs? in the air)\b/i, 'hover'],
  [/\b(lands?|settles?|touches? down)\b/i, 'land'],
  [/\b(takes? off|lifts? off)\b/i, 'take-off'],
  [/\b(sits?|sitting down)\b/i, 'sit'],
  [/\b(stands? up|gets? up|rises?)\b/i, 'stand-up'],
  [/\b(tiptoes?|sneaks?|creeps?)\b/i, 'tiptoe'],
  [/\b(gasps?|startled|jumps? back)\b/i, 'gasp'],
  [/\b(wags?|wagging)\b/i, 'wag-tail'],
  [/\b(wobbles?|jiggles?)\b/i, 'wobble'],
];

/** Emotion words in a parenthetical, mapped to the expression set. */
const EXPRESSION_WORDS: [RegExp, ExpressionId][] = [
  [/\b(excited|thrilled|delighted|amazed|wow)\b/i, 'excited'],
  [/\b(happy|cheerful|smiling|pleased|glad|warm)\b/i, 'happy'],
  [/\b(curious|intrigued|interested|wondering)\b/i, 'curious'],
  [/\b(surprised|shocked|astonished|startled)\b/i, 'surprised'],
  [/\b(thinking|thoughtful|pondering|puzzled)\b/i, 'thinking'],
  [/\b(sad|unhappy|disappointed|glum)\b/i, 'sad'],
  [/\b(worried|nervous|anxious|concerned)\b/i, 'worried'],
  [/\b(sleepy|tired|yawning|drowsy)\b/i, 'sleepy'],
  [/\b(giggling|laughing|giggly|chuckling)\b/i, 'giggling'],
  [/\b(proud|pleased with|beaming)\b/i, 'proud'],
  [/\b(yucky|disgusted|sour|eww|icky)\b/i, 'yucky'],
];

const INTERACTION_WORDS: [RegExp, InteractionKind][] = [
  [/\b(sing|song|chorus|sing-?along)\b/i, 'sing-along'],
  [/\b(count|counting|how many|number)\b/i, 'count-along'],
  [/\b(copy|do it with|try it|wave (back|with)|touch your|clap along)\b/i, 'copy-the-gesture'],
  [/\b(shout|say it|out loud|tell me)\b/i, 'shout-it-out'],
];

function detectTheme(text: string): EnvironmentTheme | null {
  const lower = text.toLowerCase();
  for (const [word, theme] of Object.entries(THEME_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return theme;
  }
  return null;
}

export function detectActions(text: string): ActionId[] {
  const found: ActionId[] = [];
  for (const [re, id] of ACTION_WORDS) {
    if (re.test(text) && !found.includes(id) && ACTION_BY_ID.has(id)) found.push(id);
  }
  return found.slice(0, 3);
}

export function detectExpression(text: string): ExpressionId | undefined {
  for (const [re, id] of EXPRESSION_WORDS) {
    if (re.test(text) && id in EXPRESSIONS) return id;
  }
  return undefined;
}

function detectInteractionKind(text: string): InteractionKind {
  for (const [re, kind] of INTERACTION_WORDS) if (re.test(text)) return kind;
  return 'question-pause';
}

/** Parse `key=value key2="two words"` into a plain object. */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|[^\s,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[2];
  return out;
}

/** A speaker cue: mostly-caps name, optional parenthetical, then a colon. */
const DIALOGUE_RE = /^([A-Z][A-Z0-9 '’.\-&]{0,28}?)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/;

export function parseScript(source: string): ParsedScript {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const warnings: { line: number; message: string }[] = [];
  const scenes: ParsedScene[] = [];
  const castOrder: string[] = [];

  let title = 'Untitled';
  let subtitle: string | undefined;
  let author: string | undefined;
  let fps = 30;
  let sceneCount = 0;

  const newScene = (name: string, attrs: Record<string, string>, line: number): ParsedScene => {
    sceneCount++;
    const theme = (attrs.theme as EnvironmentTheme) || detectTheme(name) || 'garden';
    return {
      name: name || `Scene ${sceneCount}`,
      theme,
      timeOfDay: attrs.time || attrs.timeofday,
      weather: attrs.weather,
      lighting: attrs.lighting || attrs.light,
      seed: attrs.seed ? Number(attrs.seed) : sceneCount * 37 + 11,
      beats: [],
      line,
    };
  };

  let current: ParsedScene | null = null;
  const ensureScene = (line: number) => {
    if (!current) {
      current = newScene('Scene 1', {}, line);
      scenes.push(current);
    }
    return current;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.trim();
    const lineNo = i + 1;
    if (!text) continue;

    /* --- comments --- */
    if (text.startsWith('//') || text.startsWith(';')) continue;

    /* --- document metadata: `# Title: ...` --- */
    if (/^#(?!#)/.test(text)) {
      const body = text.replace(/^#\s*/, '');
      const kv = body.match(/^(\w[\w ]*)\s*:\s*(.+)$/);
      if (kv) {
        const key = kv[1].trim().toLowerCase();
        const value = kv[2].trim();
        if (key === 'title') title = value;
        else if (key === 'subtitle') subtitle = value;
        else if (key === 'author' || key === 'by') author = value;
        else if (key === 'fps') fps = Number(value) || 30;
      } else {
        title = body;
      }
      continue;
    }

    /* --- scene heading: `## Scene: Name | attrs` --- */
    if (/^##/.test(text) || /^(INT|EXT)[.\s]/i.test(text)) {
      const body = text.replace(/^##\s*/, '').replace(/^scene\s*[:\-–]\s*/i, '');
      const [namePart, attrPart] = body.split('|');
      const attrs = parseAttrs(attrPart ?? '');
      current = newScene(namePart.trim(), attrs, lineNo);
      scenes.push(current);
      continue;
    }

    /* --- directives: `@sfx: bell` --- */
    if (text.startsWith('@')) {
      const m = text.match(/^@(\w+)\s*[:=]?\s*(.*)$/);
      if (!m) { warnings.push({ line: lineNo, message: 'Could not read this @ instruction.' }); continue; }
      const kind = m[1].toLowerCase();
      const value = m[2].trim();
      const scene = ensureScene(lineNo);
      const durMatch = value.match(/\bfor\s+([\d.]+)\s*s?\b/i) || value.match(/\b([\d.]+)\s*s\b/i);
      const duration = durMatch ? Number(durMatch[1]) : undefined;

      if (kind === 'sfx' || kind === 'sound') {
        scene.beats.push({ type: 'sfx', line: lineNo, sound: value.replace(/\s*(for\s+)?[\d.]+\s*s\b/i, '').trim(), duration });
      } else if (kind === 'music') {
        scene.beats.push({ type: 'music', line: lineNo, sound: value, duration });
      } else if (kind === 'cam' || kind === 'camera' || kind === 'shot') {
        // "close-up on BUZZY, push-in"
        const onMatch = value.match(/\bon\s+([A-Za-z0-9 '’\-]+)/i);
        const framing = value.match(/\b(extreme[- ]close[- ]up|close[- ]up|over[- ]shoulder|two[- ]shot|low[- ]angle|high[- ]angle|medium|wide|full)\b/i)?.[1];
        const move = value.match(/\b(push[- ]in|pull[- ]out|pan[- ]left|pan[- ]right|orbit|crane[- ]up|handheld|follow|static)\b/i)?.[1];
        scene.beats.push({
          type: 'camera', line: lineNo, duration,
          camera: {
            framing: framing?.toLowerCase().replace(/ /g, '-'),
            target: onMatch?.[1]?.trim().toUpperCase(),
            move: move?.toLowerCase().replace(/ /g, '-'),
          },
        });
      } else if (kind === 'note') {
        scene.beats.push({ type: 'note', line: lineNo, text: value });
      } else {
        warnings.push({ line: lineNo, message: `Unknown instruction "@${kind}". Ignored.` });
      }
      continue;
    }

    /* --- transitions: `~~ crossfade 0.6` or `CUT TO:` --- */
    if (text.startsWith('~~') || /^(CUT|FADE|DISSOLVE|WIPE)\s|(TO:)$/i.test(text)) {
      const body = text.replace(/^~~\s*/, '').toLowerCase();
      const type: TransitionType =
        /fade to black|fade out/.test(body) ? 'fade-to-black'
        : /fade to white/.test(body) ? 'fade-to-white'
        : /crossfade|dissolve|fade/.test(body) ? 'crossfade'
        : /wipe/.test(body) ? 'wipe-left'
        : /iris/.test(body) ? 'iris'
        : /whip/.test(body) ? 'whip-pan'
        : 'cut';
      const d = Number(body.match(/([\d.]+)\s*s?/)?.[1] ?? (type === 'cut' ? 0 : 0.5));
      ensureScene(lineNo).beats.push({ type: 'transition', line: lineNo, transition: { type, duration: d } });
      continue;
    }

    /* --- interaction beat: `?? Can you wave back? | 2.5s | hand-icon` --- */
    if (text.startsWith('??') || /^\(\(.*\)\)$/.test(text)) {
      const body = text.replace(/^\?\?\s*/, '').replace(/^\(\(\s*|\s*\)\)$/g, '');
      const parts = body.split('|').map((s) => s.trim());
      const prompt = parts[0];
      const durPart = parts.find((p) => /^[\d.]+\s*s?$/.test(p));
      const overlay = parts.find((p) => /^(bouncing-ball|countdown|hand-icon|answer-pop|none)$/i.test(p));
      const answer = parts.find((p, idx) => idx > 0 && p !== durPart && p !== overlay);
      ensureScene(lineNo).beats.push({
        type: 'interaction',
        line: lineNo,
        duration: durPart ? parseFloat(durPart) : undefined,
        interaction: {
          kind: detectInteractionKind(prompt),
          prompt,
          overlay: overlay?.toLowerCase(),
          answer,
        },
      });
      continue;
    }

    /* --- stage direction: `[Buzzy flies in and waves]` --- */
    if (/^[[(]/.test(text) && /[\])]$/.test(text)) {
      const body = text.replace(/^[[(]\s*|\s*[\])]$/g, '');
      const scene = ensureScene(lineNo);
      // Leading proper noun is usually the subject: "Buzzy flies in".
      const subject = body.match(/^([A-Z][a-zA-Z'’\-]*)\b/)?.[1]?.toUpperCase();
      const durMatch = body.match(/\b([\d.]+)\s*s(ec(onds?)?)?\b/i);
      scene.beats.push({
        type: 'action',
        line: lineNo,
        text: body,
        subject,
        actions: detectActions(body),
        expression: detectExpression(body),
        duration: durMatch ? Number(durMatch[1]) : undefined,
      });
      continue;
    }

    /* --- dialogue --- */
    const d = text.match(DIALOGUE_RE);
    if (d) {
      const speaker = d[1].trim().replace(/\s+/g, ' ').toUpperCase();
      const paren = d[2] ?? '';
      const body = d[3].trim();
      const scene = ensureScene(lineNo);
      if (!castOrder.includes(speaker)) castOrder.push(speaker);
      scene.beats.push({
        type: 'dialogue',
        line: lineNo,
        speaker,
        text: body,
        expression: detectExpression(paren) ?? detectExpression(body),
        actions: detectActions(paren).concat(paren ? [] : []),
        duration: Number(paren.match(/([\d.]+)\s*s\b/)?.[1]) || undefined,
      });
      continue;
    }

    /* --- anything else: treat as narration under the previous speaker --- */
    const scene = ensureScene(lineNo);
    const prev = [...scene.beats].reverse().find((b) => b.type === 'dialogue');
    if (prev && /^[a-z"'“]/.test(text)) {
      // A continuation line — append to the previous speech.
      prev.text = `${prev.text} ${text}`.trim();
    } else {
      scene.beats.push({ type: 'action', line: lineNo, text, actions: detectActions(text), expression: detectExpression(text) });
      warnings.push({ line: lineNo, message: 'Read as a stage direction. Add a name and colon to make it dialogue.' });
    }
  }

  if (!scenes.length) warnings.push({ line: 0, message: 'No scenes found. Add a line starting with "## " to begin one.' });

  return { title, subtitle, author, fps, cast: castOrder, scenes, warnings };
}

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/** Words per minute for a warm, clear children's-TV read. */
export const READ_WPM = 138;

/**
 * How long a line of dialogue takes to say.
 *
 * Word count alone is too crude — a line of one-syllable words reads far faster
 * than the same count of long ones — so we weight by syllables and add a beat
 * for each piece of punctuation the performer would pause on.
 */
export function estimateSpeechDuration(text: string, wpm = READ_WPM): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0.4;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  // ~1.4 syllables per word is average English; scale the base rate by how far
  // this line sits from that.
  const base = (words.length / wpm) * 60;
  const weighted = base * (syllables / Math.max(1, words.length * 1.4));
  const pauses =
    (text.match(/[,;:]/g)?.length ?? 0) * 0.16 +
    (text.match(/[.!?]/g)?.length ?? 0) * 0.3 +
    (text.match(/[—–]|\.\.\./g)?.length ?? 0) * 0.25;
  return Math.max(0.5, weighted * 0.55 + base * 0.45 + pauses + 0.25);
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}
