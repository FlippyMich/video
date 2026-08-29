import fs from 'node:fs';
import path from 'node:path';
import { openStudio, ROOT } from './lib/studio.mjs';

const SCRIPT = `# Title: Bench
## Scene: Garden | theme=garden time=morning seed=7
[Buzzy flies in and waves]
BUZZY (excited): Hello, friends! It's me, Buzzy the Bee!
LILY (happy): Hi Buzzy! What are we doing today?
BUZZY: We're going on a sense-ational adventure!
?? Can you wave back? | 2s | hand-icon
`;

const studio = await openStudio({ verbose: true });
const { page } = studio;

const info = await page.evaluate((src) => {
  const r = window.bloom.buildFromScript(src, { bookends: true });
  return { warnings: r.warnings, cast: r.cast, duration: r.project.meta.duration, scenes: r.project.scenes.length, shots: r.project.sequence.length };
}, SCRIPT);
console.log('project:', JSON.stringify(info, null, 1));

for (const [w, h, q] of [[1920,1080,'best'], [1280,720,'good'], [960,540,'good']]) {
  await page.evaluate(({w,h,q}) => window.bloom.init({ width: w, height: h, quality: q, subtitles: true }), {w,h,q});
  const warm = await page.evaluate(() => window.bloom.warmup());
  const b1 = await page.evaluate(() => window.bloom.benchmark(3.0, 3));
  const b2 = await page.evaluate(() => window.bloom.benchmark(9.0, 3));
  console.log(`${w}x${h} ${q}: warmup=${warm.map(x=>x.ms).join(',')}ms  title=${b1.renderMs.toFixed(0)}ms  garden=${b2.renderMs.toFixed(0)}ms  encode=${b2.encodeMs.toFixed(0)}ms`);
}

// Save sample frames at 1080p for a visual check.
await page.evaluate(() => window.bloom.init({ width: 1920, height: 1080, quality: 'best', subtitles: true }));
const out = path.join(ROOT, 'deliverables/_bench');
fs.mkdirSync(out, { recursive: true });
for (const t of [1.2, 3.0, 6.5, 8.0, 10.5, 13.0, 16.0]) {
  const data = await page.evaluate((tt) => window.bloom.renderFrame(tt, 'png'), t);
  fs.writeFileSync(path.join(out, `t${t}.png`), Buffer.from(data.split(',')[1], 'base64'));
}
console.log('frames written to deliverables/_bench');
await studio.close();
