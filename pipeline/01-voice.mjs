/**
 * Stage 1 — voice.
 *
 * Records every line of dialogue and works out frame-accurate lip-sync data
 * for it.
 *
 * The voice engine here is espeak-ng, which is a formant synthesiser: it is
 * perfectly intelligible and precisely timed, but it is a *scratch track*, not
 * a performance. The pipeline is built so that dropping real recordings into
 * `deliverables/audio/vo/` and re-running from stage 2 replaces it without any
 * other change — see docs/knowledge-base/replacing-the-voice-track.md.
 *
 * Lip-sync: espeak only emits phoneme *timings* for mbrola voices, which aren't
 * installed. So we take what it does give us — the exact phoneme sequence — and
 * distribute it across the clip using a nominal duration per phoneme class,
 * anchored to the speech region measured from the audio itself. That lands the
 * mouth shapes on the right sounds, which is what the eye actually checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStudio, ROOT, bar } from './lib/studio.mjs';

/**
 * `--measure-only` skips synthesis and reads whatever is already in
 * `deliverables/audio/vo/`. That is how you swap in real recordings: drop them
 * in under the existing filenames, run this, and the rest of the pipeline
 * retimes the film around the performances.
 */
const MEASURE_ONLY = process.argv.includes('--measure-only');

const OUT = path.join(ROOT, 'deliverables/audio/vo');
const SCRIPT = path.join(ROOT, 'content/buzzys-senseational-adventure.script.txt');

/* ------------------------------------------------------------------ *
 * Casting the voices
 * ------------------------------------------------------------------ */

const VOICES = {
  // Bright, quick and warm — the host has to carry the whole show.
  BUZZY: { voice: 'en-gb+f4', speed: 158, pitch: 72, amplitude: 175 },
  // A child: higher again, a little slower.
  LILY: { voice: 'en-gb+f3', speed: 150, pitch: 82, amplitude: 170 },
  // Small, fussy, comic.
  DOTTY: { voice: 'en-gb+f5', speed: 162, pitch: 88, amplitude: 168 },
  // A tiny bird — the highest and fastest voice in the cast.
  PIP: { voice: 'en-gb+f2', speed: 172, pitch: 95, amplitude: 165 },
  DEFAULT: { voice: 'en-gb+m3', speed: 150, pitch: 55, amplitude: 170 },
};

/**
 * Nominal length of each phoneme class, in arbitrary units.
 *
 * Vowels carry most of the duration of a syllable and plosives almost none;
 * spreading phonemes evenly instead makes the mouth chatter at a constant rate,
 * which reads as a puppet rather than as speech.
 */
const PHONEME_WEIGHT = {
  vowel: 2.6,
  diphthong: 3.4,
  nasal: 1.4,
  fricative: 1.7,
  plosive: 0.8,
  liquid: 1.3,
  glide: 1.2,
  other: 1.2,
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', '@', 'A', 'E', 'I', 'O', 'U', '3', 'V', 'Q', '&']);
const DIPHTHONGS = new Set(['aI', 'aU', 'eI', 'oU', 'OI', '@U', 'e@', 'I@', 'U@']);
const NASALS = new Set(['m', 'n', 'N']);
const FRICATIVES = new Set(['f', 'v', 's', 'z', 'S', 'Z', 'T', 'D', 'h']);
const PLOSIVES = new Set(['p', 'b', 't', 'd', 'k', 'g']);
const LIQUIDS = new Set(['l', 'r', 'R']);
const GLIDES = new Set(['w', 'j', 'y']);

function classOf(p) {
  if (DIPHTHONGS.has(p)) return 'diphthong';
  if (VOWELS.has(p[0])) return 'vowel';
  if (NASALS.has(p)) return 'nasal';
  if (FRICATIVES.has(p)) return 'fricative';
  if (PLOSIVES.has(p)) return 'plosive';
  if (LIQUIDS.has(p)) return 'liquid';
  if (GLIDES.has(p)) return 'glide';
  return 'other';
}

/**
 * Split espeak's phoneme string into individual phonemes.
 *
 * espeak writes things like `h@l'oU maI fr'Endz`: stress marks inline,
 * two-character symbols for diphthongs, spaces between words.
 */
function splitPhonemes(line) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.map((word) => {
    const cleaned = word.replace(/[',_|%=]/g, '');
    const out = [];
    for (let i = 0; i < cleaned.length; i++) {
      const two = cleaned.slice(i, i + 2);
      if (DIPHTHONGS.has(two)) { out.push(two); i++; continue; }
      // espeak marks affricates as tS / dZ.
      if (two === 'tS' || two === 'dZ') { out.push(two); i++; continue; }
      out.push(cleaned[i]);
    }
    return out.filter(Boolean);
  });
}

/* ------------------------------------------------------------------ *
 * WAV reading
 * ------------------------------------------------------------------ */

function readWav(file) {
  const buf = fs.readFileSync(file);
  // Walk the RIFF chunks rather than assuming a 44-byte header: espeak emits a
  // LIST chunk on some builds, and a fixed offset silently shifts every sample.
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`Not a readable WAV: ${file}`);
  const count = Math.floor(data.length / 2 / fmt.channels);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768;
  }
  return { samples, sampleRate: fmt.sampleRate, duration: count / fmt.sampleRate };
}

/** First and last moment with real signal, so trailing silence isn't lip-synced. */
function speechRegion(samples, sampleRate) {
  const win = Math.max(1, Math.floor(sampleRate * 0.01));
  const frames = Math.floor(samples.length / win);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const s = samples[f * win + i];
      sum += s * s;
    }
    rms[f] = Math.sqrt(sum / win);
    peak = Math.max(peak, rms[f]);
  }
  const threshold = Math.max(0.004, peak * 0.06);
  let first = 0;
  let last = frames - 1;
  while (first < frames && rms[first] < threshold) first++;
  while (last > first && rms[last] < threshold) last--;
  return {
    start: (first * win) / sampleRate,
    end: ((last + 1) * win) / sampleRate,
    rms,
    frameDuration: win / sampleRate,
    peak,
  };
}

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

function buildPhonemeTimings(wordPhonemes, region) {
  const speechStart = region.start;
  const speechLength = Math.max(0.15, region.end - region.start);

  // Weight words by their phoneme content, plus a short gap between words.
  const wordWeights = wordPhonemes.map((ph) =>
    ph.reduce((n, p) => n + PHONEME_WEIGHT[classOf(p)], 0));
  const gapWeight = 0.9;
  const total =
    wordWeights.reduce((a, b) => a + b, 0) + gapWeight * Math.max(0, wordPhonemes.length - 1);
  if (total <= 0) return [];

  const unit = speechLength / total;
  const timings = [];
  let t = speechStart;
  wordPhonemes.forEach((phonemes, wi) => {
    for (const p of phonemes) {
      const d = PHONEME_WEIGHT[classOf(p)] * unit;
      timings.push({ phoneme: p, start: t, duration: d });
      t += d;
    }
    if (wi < wordPhonemes.length - 1) {
      // A closed mouth between words. Without it every line is one long vowel.
      timings.push({ phoneme: '_', start: t, duration: gapWeight * unit });
      t += gapWeight * unit;
    }
  });
  return timings;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const source = fs.readFileSync(SCRIPT, 'utf8');
if (!MEASURE_ONLY) {
  // Start from an empty folder. Line numbering shifts whenever the script is
  // edited, so leftover takes from a previous version would linger in the
  // deliverable looking exactly like current ones.
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });

const studio = await openStudio();
const { lines, cast, title } = await studio.page.evaluate(
  (src) => window.bloom.listDialogue(src),
  source,
);
await studio.close();

console.log(`\n  "${title}"`);
console.log(`  ${lines.length} lines, cast of ${cast.length}: ${cast.join(', ')}\n`);

const timings = {};
let totalSpeech = 0;
const perSpeaker = {};

const missing = [];

lines.forEach((line, i) => {
  const v = VOICES[line.speaker] ?? VOICES.DEFAULT;
  const file = path.join(OUT, `${String(i + 1).padStart(3, '0')}-${line.speaker.toLowerCase()}.wav`);

  // espeak reads punctuation as prosody; the capitalised emphasis in the script
  // ("HELLO") would otherwise be spelled out letter by letter.
  const spoken = line.text.replace(/\b[A-Z]{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());

  if (MEASURE_ONLY) {
    if (!fs.existsSync(file)) {
      missing.push(path.basename(file));
      return;
    }
  } else execFileSync('espeak-ng', [
    '-v', v.voice,
    '-s', String(v.speed),
    '-p', String(v.pitch),
    '-a', String(v.amplitude),
    // A short gap between words gives the lip-sync somewhere to close, and
    // makes the read easier for a child to follow.
    '-g', '4',
    '-w', file,
    spoken,
  ]);

  const phonemeLine = execFileSync('espeak-ng', [
    '-v', v.voice, '-q', '-x', spoken,
  ], { encoding: 'utf8' }).trim();

  const wav = readWav(file);
  const region = speechRegion(wav.samples, wav.sampleRate);
  const wordPhonemes = splitPhonemes(phonemeLine);
  const phonemes = buildPhonemeTimings(wordPhonemes, region);

  // Trim to the speech itself. espeak leaves ~0.4s of silence on the tail of
  // every line; carried into the edit across 117 lines that is a full minute
  // of dead air, and the pacing between lines is the editor's job anyway.
  const TAIL = 0.14;
  const trimmed = Math.max(0.3, region.end - region.start + TAIL);

  timings[line.key] = {
    duration: trimmed,
    // Where in the file the speech starts, so the clip can be trimmed rather
    // than re-encoded.
    offset: region.start,
    rawDuration: wav.duration,
    // Phoneme times are relative to the trimmed clip, not to the file.
    phonemes: phonemes.map((ph) => ({ ...ph, start: ph.start - region.start })),
    src: `audio/vo/${path.basename(file)}`,
    speaker: line.speaker,
    text: line.text,
  };

  totalSpeech += trimmed;
  perSpeaker[line.speaker] = (perSpeaker[line.speaker] ?? 0) + trimmed;

  if ((i + 1) % 10 === 0 || i === lines.length - 1) {
    process.stdout.write(`\r  recording ${bar(i + 1, lines.length)} ${i + 1}/${lines.length}`);
  }
});

console.log('\n');
if (missing.length) {
  console.log(`  ${missing.length} recordings are missing and were skipped:`);
  for (const f of missing.slice(0, 8)) console.log(`    ${f}`);
  if (missing.length > 8) console.log(`    …and ${missing.length - 8} more`);
  console.log('  Those lines will fall back to an estimated length.\n');
}
const manifest = path.join(ROOT, 'deliverables/audio/voice-timings.json');
fs.writeFileSync(manifest, JSON.stringify(timings, null, 1));

console.log(`  total dialogue: ${totalSpeech.toFixed(1)}s (${(totalSpeech / 60).toFixed(2)} min)`);
for (const [who, secs] of Object.entries(perSpeaker).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${who.padEnd(8)} ${secs.toFixed(1)}s`);
}
console.log(MEASURE_ONLY
  ? `\n  measured ${lines.length - missing.length} existing recordings in deliverables/audio/vo/`
  : `\n  wrote ${lines.length} files to deliverables/audio/vo/`);
console.log(`  wrote ${path.relative(ROOT, manifest)}`);
