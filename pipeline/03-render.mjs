/**
 * Stage 3 — render.
 *
 * Drives the headless studio frame by frame and pipes the result straight into
 * ffmpeg. Nothing touches the disk in between: 14,000 JPEG frames at 1080p is
 * about 3.5GB of intermediate files per version, and writing them out only to
 * read them back is the slowest part of a naive pipeline.
 *
 * The frames travel over a local HTTP POST rather than through the automation
 * protocol, because the protocol serialises binary as text — that alone was
 * costing more than the render.
 *
 *   node pipeline/03-render.mjs [--green] [--width 1920] [--quality best]
 *                               [--from 0] [--to 30] [--out file.mp4]
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { ROOT, GL_ARGS, bar, fmt } from './lib/studio.mjs';

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const GREEN = has('green');
const WIDTH = Number(flag('width', 1920));
const HEIGHT = Number(flag('height', Math.round((WIDTH * 9) / 16)));
const QUALITY = flag('quality', 'best');
const BURN_CAPTIONS = has('captions');
const FROM = Number(flag('from', 0));
const TO = flag('to', null) === null ? null : Number(flag('to'));
const CRF = Number(flag('crf', GREEN ? 14 : 17));

const OUT = path.resolve(
  ROOT,
  flag('out', GREEN
    ? 'deliverables/video/buzzys-senseational-adventure-greenscreen.mp4'
    : 'deliverables/video/buzzys-senseational-adventure-mute.mp4'),
);

const PROJECT = path.join(ROOT, 'content/project.json');
if (!fs.existsSync(PROJECT)) {
  console.error('  No project found. Run `node pipeline/02-project.mjs` first.');
  process.exit(1);
}
const project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
const FPS = project.meta.fps;
const duration = TO ?? project.meta.duration;
const firstFrame = Math.round(FROM * FPS);
const lastFrame = Math.round(duration * FPS);
const totalFrames = lastFrame - firstFrame;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

console.log(`\n  ${GREEN ? 'Green-screen' : 'Master'} render`);
console.log(`  ${WIDTH}x${HEIGHT} @ ${FPS}fps, quality "${QUALITY}"`);
console.log(`  ${totalFrames} frames (${fmt(duration - FROM)})`);
console.log(`  → ${path.relative(ROOT, OUT)}\n`);

/* ------------------------------------------------------------------ *
 * ffmpeg
 * ------------------------------------------------------------------ */

const ffArgs = [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', String(CRF),
  // 4:2:0 is what every player and platform expects; 4:4:4 would key better
  // but half the world can't decode it.
  '-pix_fmt', 'yuv420p',
  // Two-second keyframe interval: YouTube re-encodes anyway, but a regular
  // GOP makes scrubbing in an editor far less painful.
  '-g', String(FPS * 2),
  '-movflags', '+faststart',
  OUT,
];
const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('error', (e) => { console.error('  ffmpeg failed to start:', e.message); process.exit(1); });

let written = 0;
async function pushFrame(buf) {
  if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  written++;
}

/* ------------------------------------------------------------------ *
 * Frame server: static files out, JPEG frames in
 * ------------------------------------------------------------------ */

const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/frame') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      await pushFrame(Buffer.concat(chunks));
      res.writeHead(204).end();
    });
    return;
  }
  const url = (req.url || '/').split('?')[0];
  const file = path.join(DIST, url === '/' ? '/index.html' : url);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ *
 * Browser
 * ------------------------------------------------------------------ */

let chromium;
try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
catch { chromium = require('playwright').chromium; }

const browser = await chromium.launch({ headless: true, args: GL_ARGS });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
page.on('pageerror', (e) => console.error('\n  [page:error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('\n  [page]', m.text()); });

await page.goto(`${base}/render.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.bloomReady === true, { timeout: 60_000 });

await page.evaluate((p) => window.bloom.loadProject(p), project);
await page.evaluate(
  (o) => window.bloom.init(o),
  { width: WIDTH, height: HEIGHT, quality: QUALITY, subtitles: BURN_CAPTIONS, overlays: true, chromaKey: GREEN },
);

process.stdout.write('  building sets… ');
const warm = await page.evaluate(() => window.bloom.warmup());
console.log(`${warm.reduce((n, w) => n + w.ms, 0)}ms for ${warm.length} scenes\n`);

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

const started = Date.now();
let lastReport = 0;

// Render in blocks: one round-trip per frame would spend more time in protocol
// overhead than in rendering, and a whole-film loop inside the page gives no
// progress and no way to interrupt.
const BLOCK = 30;

for (let f = firstFrame; f < lastFrame; f += BLOCK) {
  const end = Math.min(f + BLOCK, lastFrame);
  await page.evaluate(
    async ({ from, to, fps, url }) => {
      const canvas = window.bloom.canvas;
      for (let i = from; i < to; i++) {
        window.bloom.drawFrame(i / fps);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
        await fetch(url, { method: 'POST', body: blob });
      }
    },
    { from: f, to: end, fps: FPS, url: `${base}/frame` },
  );

  const now = Date.now();
  if (now - lastReport > 900 || end === lastFrame) {
    lastReport = now;
    const done = end - firstFrame;
    const elapsed = (now - started) / 1000;
    const rate = done / elapsed;
    const eta = (totalFrames - done) / Math.max(0.01, rate);
    process.stdout.write(
      `\r  ${bar(done, totalFrames)} ${done}/${totalFrames}  ${rate.toFixed(1)} fps  ETA ${fmt(eta)}   `,
    );
  }
}

console.log('\n\n  encoding…');
await browser.close();
await new Promise((r) => server.close(r));

ff.stdin.end();
const [code] = await once(ff, 'close');

const elapsed = (Date.now() - started) / 1000;
if (code !== 0) {
  console.error(`  ffmpeg exited with code ${code}`);
  process.exit(code);
}
const size = fs.statSync(OUT).size;
console.log(`  wrote ${path.relative(ROOT, OUT)} — ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  ${written} frames in ${fmt(elapsed)} (${(written / elapsed).toFixed(1)} fps)\n`);
