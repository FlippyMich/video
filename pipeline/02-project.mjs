/**
 * Stage 2 — build the project.
 *
 * Rebuilds the film from the script using the *real* voice durations recorded
 * in stage 1, so every cut, gesture and caption lands on the performance rather
 * than on an estimate. Writes the project JSON that the renderer, the exporters
 * and the editor all read.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openStudio, ROOT, fmt } from './lib/studio.mjs';

const SCRIPT = path.join(ROOT, 'content/buzzys-senseational-adventure.script.txt');
const TIMINGS = path.join(ROOT, 'deliverables/audio/voice-timings.json');
const OUT = path.join(ROOT, 'content/project.json');

const source = fs.readFileSync(SCRIPT, 'utf8');
const voiceTimings = fs.existsSync(TIMINGS)
  ? JSON.parse(fs.readFileSync(TIMINGS, 'utf8'))
  : undefined;

if (!voiceTimings) {
  console.log('  No voice timings found — falling back to estimated line lengths.');
  console.log('  Run `node pipeline/01-voice.mjs` first for a frame-accurate cut.\n');
}

const studio = await openStudio({ verbose: true });
const result = await studio.page.evaluate(
  ({ src, timings }) => {
    const r = window.bloom.buildFromScript(src, {
      voiceTimings: timings,
      bookends: true,
      beatGap: 0.2,
      titleCardText: 'Learning the five senses',
      outroText: 'Thanks for watching!',
    });
    const p = r.project;
    return {
      project: p,
      warnings: r.warnings,
      stats: {
        duration: p.meta.duration,
        scenes: p.scenes.length,
        shots: p.sequence.length,
        dialogue: p.audio.filter((a) => a.role === 'dialogue').length,
        music: p.audio.filter((a) => a.role === 'music').length,
        sfx: p.audio.filter((a) => a.role === 'sfx').length,
        captions: p.subtitles.length,
        beats: p.interactions.length,
        keyframes: p.scenes.reduce(
          (n, s) => n + s.nodes.reduce(
            (m, node) => m + (node.tracks ?? []).reduce((k, t) => k + t.keys.length, 0), 0), 0),
        sceneList: p.scenes.map((s) => ({ name: s.name, theme: s.environment.theme, nodes: s.nodes.length })),
      },
    };
  },
  { src: source, timings: voiceTimings },
);
await studio.close();

const { project, stats, warnings } = result;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(project));

if (warnings.length) {
  console.log('\n  Script warnings:');
  for (const w of warnings.slice(0, 10)) console.log(`    line ${w.line}: ${w.message}`);
}

console.log(`\n  "${project.meta.title}"`);
console.log(`  ${fmt(stats.duration)}  (${stats.duration.toFixed(1)}s @ ${project.meta.fps}fps = ${Math.round(stats.duration * project.meta.fps)} frames)`);
console.log(`  ${stats.shots} shots across ${stats.scenes} scenes`);
console.log(`  ${stats.dialogue} dialogue clips, ${stats.music} music cues, ${stats.sfx} sound effects`);
console.log(`  ${stats.captions} caption cues, ${stats.beats} audience beats`);
console.log(`  ${stats.keyframes.toLocaleString()} keyframes\n`);
for (const s of stats.sceneList) {
  console.log(`    ${s.name.padEnd(26)} ${s.theme.padEnd(11)} ${s.nodes} nodes`);
}
const size = fs.statSync(OUT).size;
console.log(`\n  wrote ${path.relative(ROOT, OUT)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
