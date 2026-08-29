/**
 * Visemes — the mouth shapes that make a character look like it's talking.
 *
 * We use the ten-shape cartoon set animators have used since Preston Blair,
 * rather than a 40-slot phoneme rig. Ten shapes is what reads on a rounded
 * cartoon face at 30fps, and it's few enough that a teacher can hand-fix a line
 * in the timeline without a phonetics degree.
 *
 * Two ways in:
 *   `visemesFromText()`  — instant, no audio needed. Good enough to block a scene.
 *   `visemesFromPhonemes()` — driven by real phoneme timings (we get these from
 *                             espeak-ng in the production pipeline). Frame-accurate.
 */

export type VisemeId =
  | 'REST'
  | 'AI'
  | 'E'
  | 'O'
  | 'U'
  | 'MBP'
  | 'FV'
  | 'L'
  | 'WQ'
  | 'ETC';

export interface VisemeShape {
  id: VisemeId;
  label: string;
  /** How far the jaw drops, 0..1. */
  open: number;
  /** Horizontal stretch: -1 fully pursed, +1 fully spread. */
  wide: number;
  /** Lip roll — positive pushes lips forward into a pucker. */
  round: number;
  /** Upper-teeth visibility, used for F/V and S sounds. */
  teeth: number;
}

export const VISEMES: Record<VisemeId, VisemeShape> = {
  REST: { id: 'REST', label: 'Closed / rest', open: 0.04, wide: 0.0, round: 0.0, teeth: 0 },
  AI: { id: 'AI', label: 'Ah / eye', open: 1.0, wide: 0.25, round: 0.0, teeth: 0.1 },
  E: { id: 'E', label: 'Eh / ee', open: 0.45, wide: 0.85, round: -0.2, teeth: 0.35 },
  O: { id: 'O', label: 'Oh', open: 0.7, wide: -0.5, round: 0.7, teeth: 0 },
  U: { id: 'U', label: 'Oo', open: 0.3, wide: -0.9, round: 1.0, teeth: 0 },
  MBP: { id: 'MBP', label: 'M / B / P', open: 0.0, wide: 0.1, round: 0.05, teeth: 0 },
  FV: { id: 'FV', label: 'F / V', open: 0.14, wide: 0.35, round: 0.0, teeth: 0.9 },
  L: { id: 'L', label: 'L / TH', open: 0.4, wide: 0.3, round: 0.0, teeth: 0.5 },
  WQ: { id: 'WQ', label: 'W / Q', open: 0.22, wide: -0.8, round: 0.9, teeth: 0 },
  ETC: { id: 'ETC', label: 'S / T / D / K', open: 0.24, wide: 0.45, round: 0.0, teeth: 0.6 },
};

export const VISEME_IDS = Object.keys(VISEMES) as VisemeId[];

/**
 * Phoneme → viseme. Keys cover both IPA (what `espeak-ng --ipa` prints) and
 * espeak's own ASCII mnemonics, so either output format works.
 */
const PHONEME_TO_VISEME: Record<string, VisemeId> = {
  // --- closed lips -------------------------------------------------
  m: 'MBP', b: 'MBP', p: 'MBP',
  // --- lip/teeth ---------------------------------------------------
  f: 'FV', v: 'FV',
  // --- tongue ------------------------------------------------------
  l: 'L', θ: 'L', ð: 'L', T: 'L', D: 'L',
  // --- rounded consonants ------------------------------------------
  w: 'WQ', r: 'WQ', ɹ: 'WQ', ʍ: 'WQ',
  // --- open vowels -------------------------------------------------
  a: 'AI', ɑ: 'AI', ʌ: 'AI', æ: 'AI', ɐ: 'AI', 'aɪ': 'AI', 'aʊ': 'AI', A: 'AI', I: 'AI',
  // --- spread vowels -----------------------------------------------
  e: 'E', ɛ: 'E', i: 'E', ɪ: 'E', 'eɪ': 'E', ə: 'E', ɜ: 'E', E: 'E',
  // --- round vowels ------------------------------------------------
  o: 'O', ɔ: 'O', 'oʊ': 'O', 'ɔɪ': 'O', O: 'O',
  u: 'U', ʊ: 'U', U: 'U',
  // --- everything else ---------------------------------------------
  s: 'ETC', z: 'ETC', t: 'ETC', d: 'ETC', k: 'ETC', g: 'ETC', n: 'ETC',
  ŋ: 'ETC', ʃ: 'ETC', ʒ: 'ETC', 'tʃ': 'ETC', 'dʒ': 'ETC', j: 'ETC', h: 'ETC',
};

export function phonemeToViseme(raw: string): VisemeId {
  // Strip stress marks, length marks and espeak's syllable separators.
  const p = raw.replace(/[ˈˌːˑ'_,|]/g, '').trim();
  if (!p) return 'REST';
  if (PHONEME_TO_VISEME[p]) return PHONEME_TO_VISEME[p];
  // Diphthongs and affricates: try the two-character head, then the first char.
  const two = p.slice(0, 2);
  if (PHONEME_TO_VISEME[two]) return PHONEME_TO_VISEME[two];
  const one = p[0];
  return PHONEME_TO_VISEME[one] ?? PHONEME_TO_VISEME[one?.toLowerCase()] ?? 'ETC';
}

/* ------------------------------------------------------------------ *
 * Text-driven (no audio required)
 * ------------------------------------------------------------------ */

export interface VisemeEvent {
  viseme: VisemeId;
  start: number;
  duration: number;
}

/**
 * Very rough English grapheme → viseme pass. It's not phonetically correct and
 * doesn't pretend to be; it just has to put an open mouth on the vowels and a
 * closed one on the M/B/Ps, which is 90% of what "reads" as talking.
 */
function graphemesToVisemes(word: string): VisemeId[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, '');
  const out: VisemeId[] = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const next = w[i + 1] ?? '';
    const pair = c + next;

    // Digraphs first — otherwise "sh" becomes S then H.
    if (pair === 'oo' || pair === 'ou' || pair === 'ew') { out.push('U'); i++; continue; }
    if (pair === 'oa' || pair === 'ow' || pair === 'oi' || pair === 'oy') { out.push('O'); i++; continue; }
    if (pair === 'ee' || pair === 'ea' || pair === 'ie' || pair === 'ey') { out.push('E'); i++; continue; }
    if (pair === 'ai' || pair === 'ay' || pair === 'igh') { out.push('AI'); i++; continue; }
    if (pair === 'th') { out.push('L'); i++; continue; }
    if (pair === 'ph') { out.push('FV'); i++; continue; }
    if (pair === 'ch' || pair === 'sh' || pair === 'ck') { out.push('ETC'); i++; continue; }
    if (pair === 'wh') { out.push('WQ'); i++; continue; }

    if ('aeiou'.includes(c)) {
      // Silent trailing "e" — "smile" shouldn't end on a wide E.
      if (c === 'e' && i === w.length - 1 && w.length > 2) continue;
      out.push(c === 'a' ? 'AI' : c === 'e' ? 'E' : c === 'i' ? 'AI' : c === 'o' ? 'O' : 'U');
      continue;
    }
    if ('mbp'.includes(c)) { out.push('MBP'); continue; }
    if ('fv'.includes(c)) { out.push('FV'); continue; }
    if (c === 'l') { out.push('L'); continue; }
    if (c === 'w' || c === 'r' || c === 'q') { out.push('WQ'); continue; }
    if (c === 'y') { out.push('E'); continue; }
    if (c === 'h' || c === "'") continue;
    out.push('ETC');
  }
  // Collapse runs — holding one shape for two frames beats flickering.
  return out.filter((v, i) => v !== out[i - 1]);
}

/** Average English speaking rate for a friendly kids-TV read, in words/minute. */
export const DEFAULT_WPM = 145;

/**
 * Lay out viseme events for a line of dialogue across a known time window.
 * Used when there is no recorded audio yet, or as a fallback if phoneme
 * extraction fails.
 */
export function visemesFromText(text: string, start: number, duration: number): VisemeEvent[] {
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length || duration <= 0) return [];

  // Weight each word by its viseme count so "extraordinary" gets more room
  // than "a", then scale the whole line to fit the window exactly.
  const perWord = words.map((w) => graphemesToVisemes(w));
  const totalShapes = perWord.reduce((n, v) => n + Math.max(1, v.length), 0);
  // Reserve a slice of the line for the gaps between words.
  const gapShare = Math.min(0.22, 0.05 * words.length);
  const speechTime = duration * (1 - gapShare);
  const gapTime = words.length > 1 ? (duration * gapShare) / (words.length - 1) : 0;
  const unit = speechTime / totalShapes;

  const events: VisemeEvent[] = [];
  let t = start;
  perWord.forEach((shapes, wi) => {
    const list = shapes.length ? shapes : (['ETC'] as VisemeId[]);
    for (const v of list) {
      events.push({ viseme: v, start: t, duration: unit });
      t += unit;
    }
    if (wi < words.length - 1) {
      // Between words the mouth relaxes rather than snapping shut.
      if (gapTime > 0.06) events.push({ viseme: 'REST', start: t, duration: gapTime });
      t += gapTime;
    }
  });
  events.push({ viseme: 'REST', start: start + duration, duration: 0.12 });
  return events;
}

export interface PhonemeTiming {
  phoneme: string;
  /** Seconds from the start of the clip. */
  start: number;
  duration: number;
}

/** Frame-accurate lip-sync from real phoneme timings. */
export function visemesFromPhonemes(timings: PhonemeTiming[], offset = 0): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  for (const p of timings) {
    const v = phonemeToViseme(p.phoneme);
    const last = events[events.length - 1];
    // Merge neighbouring identical shapes so the mouth holds instead of buzzing.
    if (last && last.viseme === v) {
      last.duration = p.start + p.duration + offset - last.start;
      continue;
    }
    events.push({ viseme: v, start: p.start + offset, duration: p.duration });
  }
  const tail = events[events.length - 1];
  if (tail) events.push({ viseme: 'REST', start: tail.start + tail.duration, duration: 0.12 });
  return events;
}

/**
 * Turn viseme events into animation keys, one track per viseme weight.
 *
 * Each shape gets an attack a little before its nominal start: real mouths
 * anticipate sounds, and without this the animation always reads as late.
 */
export function visemeEventsToTracks(
  events: VisemeEvent[],
  opts: { anticipation?: number; intensity?: number } = {},
): { channel: string; keys: { t: number; v: number }[] }[] {
  const anticipation = opts.anticipation ?? 0.035;
  const intensity = opts.intensity ?? 1;
  const byViseme = new Map<VisemeId, { t: number; v: number }[]>();
  for (const id of VISEME_IDS) byViseme.set(id, []);

  for (const ev of events) {
    const keys = byViseme.get(ev.viseme)!;
    const hold = Math.max(0.03, ev.duration);
    const inT = Math.max(0, ev.start - anticipation);
    const peakT = ev.start + hold * 0.35;
    const outT = ev.start + hold;
    const push = (t: number, v: number) => {
      const prev = keys[keys.length - 1];
      if (prev && Math.abs(prev.t - t) < 1e-4) { prev.v = Math.max(prev.v, v); return; }
      if (prev && prev.t > t) return;
      keys.push({ t, v });
    };
    push(inT, 0);
    push(peakT, intensity);
    push(outT, 0);
  }

  return VISEME_IDS.filter((id) => byViseme.get(id)!.length > 0).map((id) => ({
    channel: `viseme.${id}`,
    keys: byViseme.get(id)!,
  }));
}

/** Blend weighted viseme shapes into one mouth pose. */
export function blendVisemes(weights: Partial<Record<VisemeId, number>>): VisemeShape {
  let open = 0, wide = 0, round = 0, teeth = 0, total = 0;
  for (const id of VISEME_IDS) {
    const w = weights[id] ?? 0;
    if (w <= 0.001) continue;
    const s = VISEMES[id];
    open += s.open * w; wide += s.wide * w; round += s.round * w; teeth += s.teeth * w;
    total += w;
  }
  if (total <= 0.001) return VISEMES.REST;
  const n = Math.max(1, total);
  return { id: 'REST', label: 'blend', open: open / n, wide: wide / n, round: round / n, teeth: teeth / n };
}
