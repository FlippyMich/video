/**
 * Stage 8 — deliver.
 *
 * Takes the silent picture renders and the finished mix and produces the files
 * that actually get handed over: the master, a captions-burned-in cut, and the
 * green-screen version.
 *
 * Everything here is a stream copy of the video plus an audio encode, so it
 * takes seconds rather than re-rendering an hour of picture. The burned-in
 * captions are the one exception — subtitle burn-in has to touch every pixel —
 * and that is still far cheaper than a second 3D render.
 *
 *   node pipeline/08-deliver.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, fmt } from './lib/studio.mjs';

const VIDEO = path.join(ROOT, 'deliverables/video');
const AUDIO = path.join(ROOT, 'deliverables/audio');
const CAPTIONS = path.join(ROOT, 'deliverables/captions');

const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/project.json'), 'utf8'));
const SLUG = 'buzzys-senseational-adventure';

const ff = (args, label) => {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) throw new Error(`${label} failed (ffmpeg ${r.status})`);
};

/**
 * Move a silent picture render out of the deliverables, without deleting it.
 *
 * It is an intermediate and shouldn't sit next to the finished files — but it
 * cost an hour of rendering, and if the mix later needs a fix, re-muxing takes
 * seconds while re-rendering does not.
 */
const retire = (file) => {
  if (!fs.existsSync(file)) return;
  const dir = path.join(VIDEO, 'intermediate');
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(file, path.join(dir, path.basename(file)));
};

const need = (file, what) => {
  if (!fs.existsSync(file)) {
    console.error(`  Missing ${what}: ${path.relative(ROOT, file)}`);
    console.error('  Run the earlier pipeline stages first (see pipeline/run-all.sh).');
    process.exit(1);
  }
};

const MUTE = path.join(VIDEO, `${SLUG}-mute.mp4`);
const GREEN_MUTE = path.join(VIDEO, `${SLUG}-greenscreen.mp4`);
const MIX = path.join(AUDIO, 'full-mix.wav');
const SRT = path.join(CAPTIONS, `${SLUG}.en.srt`);
const ASS = path.join(CAPTIONS, `${SLUG}.en.ass`);

need(MUTE, 'the master picture render');
need(MIX, 'the audio mix');

console.log(`\n  Delivering "${project.meta.title}" — ${fmt(project.meta.duration)}\n`);

/* ------------------------------------------------------------------ *
 * The master
 * ------------------------------------------------------------------ */

const MASTER = path.join(VIDEO, `${SLUG}-1080p.mp4`);
console.log('  master with sound…');
ff([
  '-i', MUTE,
  '-i', MIX,
  // The picture is already encoded exactly as delivered; re-encoding it here
  // would cost an hour and lose a generation for nothing.
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
  // The audio stems are padded to the film's length, but a stream that runs a
  // frame longer than the picture makes some players report the wrong duration.
  '-shortest',
  '-movflags', '+faststart',
  MASTER,
], 'master mux');

/* ------------------------------------------------------------------ *
 * Burned-in captions
 * ------------------------------------------------------------------ */

const subtitleFile = fs.existsSync(ASS) ? ASS : fs.existsSync(SRT) ? SRT : null;
if (subtitleFile) {
  const CAPTIONED = path.join(VIDEO, `${SLUG}-1080p-captions.mp4`);
  console.log('  captioned cut…');
  // The .ass carries its own PlayRes and style, matched to the captions the
  // renderer draws. Burning the .srt instead means letting the converter
  // invent a 384x288 script and scaling every size against it.
  ff([
    '-i', MASTER,
    '-vf', `subtitles='${subtitleFile.replace(/'/g, "'\\''")}'`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    CAPTIONED,
  ], 'caption burn-in');
}

/* ------------------------------------------------------------------ *
 * Green screen
 * ------------------------------------------------------------------ */

if (fs.existsSync(GREEN_MUTE)) {
  const GREEN = path.join(VIDEO, `${SLUG}-1080p-greenscreen.mp4`);
  console.log('  green-screen version with sound…');
  ff([
    '-i', GREEN_MUTE,
    '-i', MIX,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
    GREEN,
  ], 'green-screen mux');
  retire(GREEN_MUTE);
} else {
  console.log('  (no green-screen render found — run `node pipeline/03-render.mjs --green`)');
}

retire(MUTE);

/* ------------------------------------------------------------------ *
 * A poster frame, and the report
 * ------------------------------------------------------------------ */

const POSTER = path.join(VIDEO, `${SLUG}-thumbnail.jpg`);
// A frame from the middle of the "seeing" section: Buzzy, a rainbow, a smile.
ff(['-ss', '96', '-i', MASTER, '-frames:v', '1', '-q:v', '2', POSTER], 'poster frame');

console.log('\n  Delivered:');
for (const f of fs.readdirSync(VIDEO).sort()) {
  const p = path.join(VIDEO, f);
  if (fs.statSync(p).isDirectory()) continue;
  const size = fs.statSync(p).size;
  let extra = '';
  try {
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-of', 'default=nw=1', p,
    ], { encoding: 'utf8' });
    const dur = probe.match(/duration=([\d.]+)/)?.[1];
    const streams = [...probe.matchAll(/codec_name=(\w+)/g)].map((m) => m[1]);
    const dims = probe.match(/width=(\d+)[\s\S]*?height=(\d+)/);
    extra = `  ${dims ? `${dims[1]}×${dims[2]}  ` : ''}${dur ? `${fmt(Number(dur))}  ` : ''}${streams.join('+')}`;
  } catch { /* ffprobe is optional */ }
  console.log(`    ${f.padEnd(48)} ${(size / 1024 / 1024).toFixed(1).padStart(6)} MB${extra}`);
}
console.log('');
