/**
 * Stage 7 — the final script, with timestamps, as a Word document.
 *
 * This is an *as-broadcast* script, generated from the finished project rather
 * than from the writer's draft: every timecode is where the line actually falls
 * in the delivered file. That's the version a translator, a caption house or a
 * teacher planning a lesson round the video needs.
 *
 *   node pipeline/07-script-doc.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat,
  PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TabStopType, TextRun, WidthType,
} from 'docx';
import { ROOT } from './lib/studio.mjs';

const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/project.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'deliverables/documents');
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * Palette — matched to the film so the paperwork looks like the show
 * ------------------------------------------------------------------ */

const INK = '2E2838';
const MUTED = '6B6478';
const HONEY = 'B67F14';
const LEAF = '2F7D43';
const PLUM = '7A4FB5';
const RULE = 'D9D3E4';

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
const tc = (t) => `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)}:${pad(((t % 1) * project.meta.fps))}`;
const clock = (t) => `${pad(t / 60)}:${pad(t % 60)}`;

/* ------------------------------------------------------------------ *
 * Assemble a time-ordered event list
 * ------------------------------------------------------------------ */

const sceneById = new Map(project.scenes.map((s) => [s.id, s]));
const shotsByScene = new Map();
for (const shot of project.sequence) {
  const list = shotsByScene.get(shot.sceneId) ?? [];
  list.push(shot);
  shotsByScene.set(shot.sceneId, list);
}

const sceneSpans = project.scenes.map((scene) => {
  const shots = shotsByScene.get(scene.id) ?? [];
  const start = shots.length ? Math.min(...shots.map((s) => s.start)) : 0;
  const end = shots.length ? Math.max(...shots.map((s) => s.start + s.duration)) : 0;
  return { scene, start, end, shots: shots.length };
}).sort((a, b) => a.start - b.start);

const events = [];
for (const clip of project.audio) {
  if (clip.role === 'dialogue') {
    const [speaker, ...rest] = (clip.label ?? '').split(': ');
    events.push({
      t: clip.start, kind: 'dialogue', speaker,
      text: rest.join(': '), duration: clip.duration, src: clip.src,
    });
  } else {
    events.push({
      t: clip.start, kind: clip.role, label: clip.label ?? path.basename(clip.src, '.wav'),
      duration: clip.duration,
    });
  }
}
for (const beat of project.interactions) {
  events.push({
    t: beat.start, kind: 'audience', prompt: beat.prompt,
    beatKind: beat.kind, duration: beat.duration, answer: beat.answer,
  });
}
events.sort((a, b) => a.t - b.t || (a.kind === 'dialogue' ? 1 : -1));

// Dialogue labels are truncated for the timeline UI; recover the full lines
// from the recorded takes so the document carries the real text.
const timingsPath = path.join(ROOT, 'deliverables/audio/voice-timings.json');
if (fs.existsSync(timingsPath)) {
  const byFile = new Map(
    Object.values(JSON.parse(fs.readFileSync(timingsPath, 'utf8')))
      .map((v) => [path.basename(v.src), v.text]),
  );
  for (const e of events) {
    if (e.kind !== 'dialogue') continue;
    const full = byFile.get(path.basename(e.src ?? ''));
    if (full) e.text = full;
  }
}

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

const TAB = 1300; // twips: where the content column starts

function timedLine(time, runs, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 60, after: opts.after ?? 20 },
    indent: { left: TAB, hanging: TAB },
    tabStops: [{ type: TabStopType.LEFT, position: TAB }],
    children: [
      new TextRun({ text: time, font: 'Consolas', size: 17, color: MUTED, bold: false }),
      new TextRun({ text: '\t', font: 'Consolas', size: 17 }),
      ...runs,
    ],
  });
}

function rule() {
  return new Paragraph({
    spacing: { before: 120, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
    children: [new TextRun('')],
  });
}

function label(text, color) {
  return new TextRun({ text, bold: true, size: 17, color, font: 'Segoe UI' });
}

/* ------------------------------------------------------------------ *
 * Title page
 * ------------------------------------------------------------------ */

const cast = [...new Set(events.filter((e) => e.kind === 'dialogue').map((e) => e.speaker))];
const lineCount = events.filter((e) => e.kind === 'dialogue').length;
const beatCount = project.interactions.length;

const titlePage = [
  new Paragraph({ spacing: { before: 2600 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({
      text: project.meta.title, bold: true, size: 60, color: HONEY, font: 'Segoe UI',
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 700 },
    children: [new TextRun({
      text: project.meta.subtitle ?? '', size: 26, color: MUTED, font: 'Segoe UI',
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({
      text: 'FINAL SCRIPT — AS BROADCAST', bold: true, size: 22, color: INK,
      font: 'Segoe UI', characterSpacing: 60,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 900 },
    children: [new TextRun({
      text: `Running time ${clock(project.meta.duration)}  ·  ` +
            `${project.meta.width}×${project.meta.height} at ${project.meta.fps}fps  ·  ` +
            `Generated ${new Date().toISOString().slice(0, 10)}`,
      size: 19, color: MUTED, font: 'Segoe UI',
    })],
  }),
];

function summaryTable() {
  const rows = [
    ['Running time', `${clock(project.meta.duration)} (${project.meta.duration.toFixed(1)}s, ${Math.round(project.meta.duration * project.meta.fps)} frames)`],
    ['Format', `${project.meta.width}×${project.meta.height}, 16:9, ${project.meta.fps}fps`],
    ['Scenes', String(project.scenes.length)],
    ['Shots', String(project.sequence.length)],
    ['Spoken lines', String(lineCount)],
    ['Audience beats', String(beatCount)],
    ['Caption cues', String(project.subtitles.length)],
    ['Cast', cast.join(', ')],
  ];
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [2600, 6400],
    rows: rows.map(([k, v], i) => new TableRow({
      children: [
        new TableCell({
          width: { size: 2600, type: WidthType.DXA },
          shading: i % 2 ? undefined : { type: ShadingType.CLEAR, fill: 'FAF6FF' },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 19, color: INK, font: 'Segoe UI' })] })],
        }),
        new TableCell({
          width: { size: 6400, type: WidthType.DXA },
          shading: i % 2 ? undefined : { type: ShadingType.CLEAR, fill: 'FAF6FF' },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          children: [new Paragraph({ children: [new TextRun({ text: v, size: 19, color: INK, font: 'Segoe UI' })] })],
        }),
      ],
    })),
  });
}

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */

const body = [];

body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { after: 200 },
  children: [new TextRun({ text: 'Production summary', bold: true, size: 30, color: INK, font: 'Segoe UI' })],
}));
body.push(summaryTable());

body.push(new Paragraph({
  spacing: { before: 400, after: 120 },
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text: 'How to read this script', bold: true, size: 24, color: INK, font: 'Segoe UI' })],
}));
for (const [swatch, colour, text] of [
  ['DIALOGUE', INK, 'Spoken lines. The timecode is where the line starts in the delivered file.'],
  ['((AUDIENCE))', PLUM, 'A pause for the children to answer, sing or copy a gesture. The hold length is given.'],
  ['[SFX]', LEAF, 'Sound effect.'],
  ['[MUSIC]', HONEY, 'Music cue. Beds run until the next cue.'],
]) {
  body.push(new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${swatch}  `, bold: true, size: 19, color: colour, font: 'Segoe UI' }),
      new TextRun({ text, size: 19, color: MUTED, font: 'Segoe UI' }),
    ],
  }));
}
body.push(new Paragraph({
  spacing: { before: 140 },
  indent: { left: 360 },
  children: [new TextRun({
    text: 'Timecodes are HH:MM:SS:FF at ' + project.meta.fps + 'fps, from the first frame of the file. ' +
          'The full shot-by-shot breakdown is in shot-list.csv.',
    size: 19, color: MUTED, italics: true, font: 'Segoe UI',
  })],
}));

body.push(new Paragraph({ children: [new PageBreak()] }));

let eventIndex = 0;
sceneSpans.forEach((span, si) => {
  const { scene, start, end } = span;
  const env = scene.environment;

  if (si > 0) body.push(rule());
  body.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: si === 0 ? 0 : 240, after: 40 },
    children: [new TextRun({
      text: `${si + 1}.  ${scene.name.toUpperCase()}`,
      bold: true, size: 28, color: HONEY, font: 'Segoe UI',
    })],
  }));
  body.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: `${tc(start)} – ${tc(end)}   ·   ${(end - start).toFixed(1)}s   ·   ` +
            `${env.theme}, ${env.timeOfDay ?? 'day'}${env.weather && env.weather !== 'clear' ? `, ${env.weather}` : ''}` +
            `   ·   ${span.shots} shots`,
      size: 18, color: MUTED, font: 'Segoe UI',
    })],
  }));

  while (eventIndex < events.length && events[eventIndex].t < end - 1e-6) {
    const e = events[eventIndex++];
    if (e.t < start - 1e-6) continue;

    if (e.kind === 'dialogue') {
      body.push(timedLine(tc(e.t), [
        new TextRun({ text: e.speaker, bold: true, size: 20, color: INK, font: 'Segoe UI', characterSpacing: 30 }),
      ], { before: 160, after: 0 }));
      body.push(new Paragraph({
        spacing: { after: 60 },
        indent: { left: TAB },
        children: [new TextRun({ text: e.text, size: 21, color: INK, font: 'Segoe UI' })],
      }));
    } else if (e.kind === 'audience') {
      body.push(timedLine(tc(e.t), [
        label('((AUDIENCE))  ', PLUM),
        new TextRun({ text: e.prompt, size: 20, color: PLUM, font: 'Segoe UI' }),
        new TextRun({
          text: `   — hold ${e.duration.toFixed(1)}s${e.answer ? `, answer: “${e.answer}”` : ''}`,
          size: 18, color: MUTED, italics: true, font: 'Segoe UI',
        }),
      ], { before: 140 }));
    } else if (e.kind === 'music') {
      body.push(timedLine(tc(e.t), [
        label('[MUSIC]  ', HONEY),
        new TextRun({ text: e.label, size: 19, color: HONEY, font: 'Segoe UI' }),
      ]));
    } else {
      body.push(timedLine(tc(e.t), [
        label('[SFX]  ', LEAF),
        new TextRun({ text: e.label, size: 19, color: LEAF, font: 'Segoe UI' }),
      ]));
    }
  }
});

/* ---- teaching notes ---- */
body.push(new Paragraph({ children: [new PageBreak()] }));
body.push(new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { after: 160 },
  children: [new TextRun({ text: 'Notes for teachers and carers', bold: true, size: 30, color: INK, font: 'Segoe UI' })],
}));
body.push(new Paragraph({
  spacing: { after: 200 },
  children: [new TextRun({
    text: 'The video teaches the five senses in order, one per section, and returns to a counting recap ' +
          'after each one. Each section follows the same shape: name the sense, try it, name it again, count it. ' +
          'That repetition is deliberate — it is what makes the recap song land.',
    size: 21, color: INK, font: 'Segoe UI',
  })],
}));

const senses = [
  ['Sight', 'Eyes', 'Cover your eyes, then open them. Find something red, yellow and green.'],
  ['Hearing', 'Ears', 'Close your eyes and listen. Tell loud sounds from quiet ones. Clap along.'],
  ['Smell', 'Nose', 'Take a deep breath in. Name a favourite smell, and a not-so-nice one.'],
  ['Taste', 'Tongue', 'Sweet strawberry against sour lemon — plus the rule about asking a grown-up first.'],
  ['Touch', 'Skin', 'Soft moss, a prickly pinecone, a smooth cold rock. Feel your own cheek.'],
];
body.push(new Table({
  width: { size: 9000, type: WidthType.DXA },
  columnWidths: [1700, 1500, 5800],
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['Sense', 'Body part', 'What the children do'].map((h, i) => new TableCell({
        width: { size: [1700, 1500, 5800][i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'FFF3D6' },
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 19, color: INK, font: 'Segoe UI' })] })],
      })),
    }),
    ...senses.map(([a, b, c], r) => new TableRow({
      children: [a, b, c].map((v, i) => new TableCell({
        width: { size: [1700, 1500, 5800][i], type: WidthType.DXA },
        shading: r % 2 ? undefined : { type: ShadingType.CLEAR, fill: 'FAF6FF' },
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: v, size: 19, color: INK, font: 'Segoe UI', bold: i === 0 })] })],
      })),
    })),
  ],
}));

body.push(new Paragraph({
  spacing: { before: 320, after: 100 },
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text: 'Where to pause', bold: true, size: 24, color: INK, font: 'Segoe UI' })],
}));
body.push(new Paragraph({
  spacing: { after: 140 },
  children: [new TextRun({
    text: `There are ${beatCount} built-in pauses. Each one already holds long enough for a group to answer, ` +
          'but pausing the video on the prompt card gives a class as long as it needs.',
    size: 21, color: INK, font: 'Segoe UI',
  })],
}));
for (const beat of project.interactions) {
  body.push(new Paragraph({
    numbering: { reference: 'beats', level: 0 },
    spacing: { after: 30 },
    children: [
      new TextRun({ text: `${clock(beat.start)}  `, font: 'Consolas', size: 18, color: MUTED }),
      new TextRun({ text: beat.prompt, size: 19, color: INK, font: 'Segoe UI' }),
    ],
  }));
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

const doc = new Document({
  creator: project.meta.author ?? 'BloomStudio',
  title: project.meta.title,
  description: 'Final as-broadcast script with timestamps',
  numbering: {
    config: [{
      reference: 'beats',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 520, hanging: 240 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: 'Segoe UI', size: 21, color: INK } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 120 },
          children: [new TextRun({
            text: `${project.meta.title}  ·  final script`, size: 16, color: MUTED, font: 'Segoe UI',
          })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED, font: 'Segoe UI' })],
        })],
      }),
    },
    children: [...titlePage, ...body],
  }],
});

const out = path.join(OUT_DIR, 'buzzys-senseational-adventure-final-script.docx');
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(out, buffer);

console.log(`\n  Wrote ${path.relative(ROOT, out)} (${(buffer.length / 1024).toFixed(0)} KB)`);
console.log(`  ${lineCount} lines, ${beatCount} audience beats, ${project.scenes.length} scenes\n`);
