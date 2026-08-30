/**
 * Stage 5 — the audio mix.
 *
 * Builds three stems (voice, music, effects) from the project's audio clips,
 * ducks the music and effects under the dialogue, and writes both the finished
 * mix and the separate stems.
 *
 * Stems are a deliverable in their own right, not an intermediate: anyone
 * re-versioning the film — a translation, a different music bed, a broadcast
 * mix — needs the parts, and rebuilding them from a flattened mix is
 * impossible.
 *
 *   node pipeline/05-mix.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT, fmt } from './lib/studio.mjs';

const AUDIO = path.join(ROOT, 'deliverables/audio');
const PROJECT = path.join(ROOT, 'content/project.json');
const project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
const DURATION = project.meta.duration;

const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
};

const resolve = (src) => path.join(ROOT, 'deliverables', src);
const exists = (src) => fs.existsSync(resolve(src));

/* ------------------------------------------------------------------ *
 * Music spans
 *
 * A `@music` cue in the script means "play this until something else starts",
 * not "play 20 seconds of this". Cues are short loops, so each one is looped to
 * fill its span.
 * ------------------------------------------------------------------ */

function musicSpans() {
  const cues = project.audio
    .filter((a) => a.role === 'music')
    .sort((a, b) => a.start - b.start);
  return cues.map((cue, i) => {
    const next = cues[i + 1];
    // The logo sting and the outro are one-shots that must not be stretched.
    const oneShot = /logo-sting|outro/.test(cue.src);
    const until = next ? next.start : DURATION;
    const span = oneShot ? cue.duration : Math.max(2, until - cue.start - 0.35);
    return { ...cue, span };
  });
}

/* ------------------------------------------------------------------ *
 * Stem building
 * ------------------------------------------------------------------ */

/**
 * Mix a list of placed clips into one continuous stem.
 *
 * ffmpeg is invoked once per stem with every clip as an input. `amix` with
 * `normalize=0` is essential: the default divides by the input count, which on
 * a 102-clip dialogue stem would make it inaudible.
 */
function buildStem(name, clips, { loop = false } = {}) {
  const out = path.join(AUDIO, `${name}.wav`);
  const usable = clips.filter((c) => exists(c.src));
  const missing = clips.length - usable.length;

  if (!usable.length) {
    ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(DURATION), out]);
    console.log(`    ${name.padEnd(10)} (silent — no source files found)`);
    return { out, count: 0, missing };
  }

  const args = [];
  const filters = [];
  const labels = [];

  usable.forEach((clip, i) => {
    const dur = loop ? clip.span : clip.duration;
    if (loop) args.push('-stream_loop', '-1');
    if (clip.offset) args.push('-ss', String(clip.offset));
    args.push('-t', String(dur), '-i', resolve(clip.src));

    const delayMs = Math.max(0, Math.round(clip.start * 1000));
    const chain = [
      'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
      `volume=${(clip.gain ?? 1).toFixed(3)}`,
    ];
    if (clip.fadeIn) chain.push(`afade=t=in:st=0:d=${clip.fadeIn}`);
    if (clip.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, dur - clip.fadeOut)}:d=${clip.fadeOut}`);
    // Every clip gets a 20ms edge fade whether it asked for one or not — a
    // hard cut into a waveform mid-cycle is an audible click.
    chain.push('afade=t=in:st=0:d=0.02');
    chain.push(`afade=t=out:st=${Math.max(0, dur - 0.02)}:d=0.02`);
    chain.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${i}:a]${chain.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });

  filters.push(
    `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[mixed]`,
  );
  // Pad to the full length so every stem is the same duration as the film.
  filters.push(`[mixed]apad,atrim=0:${DURATION},asetpts=N/SR/TB[out]`);

  ff([
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
    out,
  ]);

  console.log(`    ${name.padEnd(10)} ${usable.length} clips${missing ? `  (${missing} missing)` : ''}`);
  return { out, count: usable.length, missing };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log(`\n  Mixing "${project.meta.title}" — ${fmt(DURATION)}\n`);
console.log('  Stems');

const dialogue = project.audio.filter((a) => a.role === 'dialogue');
const sfx = project.audio.filter((a) => a.role === 'sfx' || a.role === 'ambience');
const music = musicSpans();

const voiceStem = buildStem('voiceover', dialogue);
const sfxStem = buildStem('sfx', sfx);
const musicStem = buildStem('music', music, { loop: true });

/* ---- the mix ---- */
const MIX = path.join(AUDIO, 'full-mix.wav');
console.log('\n  Ducking music under dialogue…');

ff([
  '-i', voiceStem.out,
  '-i', musicStem.out,
  '-i', sfxStem.out,
  '-filter_complex', [
    // Dialogue is the reference. A gentle 3:1 with a slow release keeps the bed
    // from pumping between lines — a fast release on speech is very audible.
    '[0:a]asplit=3[vo][key1][key2]',
    '[1:a][key1]sidechaincompress=threshold=0.04:ratio=3.6:attack=12:release=420:makeup=1[music_ducked]',
    '[2:a][key2]sidechaincompress=threshold=0.06:ratio=2.2:attack=8:release=260:makeup=1[sfx_ducked]',
    '[vo]volume=1.0[vo_out]',
    '[music_ducked]volume=0.62[music_out]',
    '[sfx_ducked]volume=0.8[sfx_out]',
    '[vo_out][music_out][sfx_out]amix=inputs=3:normalize=0:dropout_transition=0[premix]',
    // Broadcast-ish loudness with real headroom. YouTube normalises to about
    // -14 LUFS; delivering close to that avoids its own limiter touching the mix.
    '[premix]loudnorm=I=-15:TP=-1.5:LRA=11,alimiter=limit=0.95[out]',
  ].join(';'),
  '-map', '[out]',
  '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
  MIX,
]);

/* ---- distributable stem copies ---- */
console.log('  Writing stem masters…');
for (const [src, name] of [
  [voiceStem.out, 'voiceover'],
  [musicStem.out, 'music'],
  [sfxStem.out, 'sfx'],
  [MIX, 'full-mix'],
]) {
  ff(['-i', src, '-c:a', 'aac', '-b:a', '256k', path.join(AUDIO, `${name}.m4a`)]);
}

const report = (f) => {
  const p = path.join(AUDIO, f);
  if (!fs.existsSync(p)) return;
  const out = execFileSync('ffmpeg', ['-hide_banner', '-i', p, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  void out;
};
report('full-mix.wav');

console.log('\n  Wrote:');
for (const f of ['voiceover.wav', 'music.wav', 'sfx.wav', 'full-mix.wav',
                 'voiceover.m4a', 'music.m4a', 'sfx.m4a', 'full-mix.m4a']) {
  const p = path.join(AUDIO, f);
  if (fs.existsSync(p)) {
    console.log(`    ${f.padEnd(18)} ${(fs.statSync(p).size / 1024 / 1024).toFixed(1)} MB`);
  }
}
console.log('');
