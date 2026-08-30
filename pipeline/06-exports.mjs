/**
 * Stage 6 — everything that isn't the video file.
 *
 * Captions (SRT + WebVTT), the 3D scenes as glTF with baked animation, a
 * Blender import script, a shot list and a cue sheet.
 *
 *   node pipeline/06-exports.mjs [--no-gltf]
 */

import fs from 'node:fs';
import path from 'node:path';
import { openStudio, ROOT, fmt } from './lib/studio.mjs';

const argv = process.argv.slice(2);
const SKIP_GLTF = argv.includes('--no-gltf');

const PROJECT = path.join(ROOT, 'content/project.json');
const project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
const FPS = project.meta.fps;

const OUT = path.join(ROOT, 'deliverables');
const CAPTIONS = path.join(OUT, 'captions');
const SCENES = path.join(OUT, 'blender');
const DOCS = path.join(OUT, 'documents');
for (const d of [CAPTIONS, SCENES, DOCS]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ *
 * Captions
 * ------------------------------------------------------------------ */

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

function timecode(t, sep = ',') {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

function writeCaptions() {
  const cues = [...project.subtitles].sort((a, b) => a.start - b.start);

  // Overlapping cues make a player show two boxes at once; clamp each cue to
  // the start of the next.
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].end = Math.min(cues[i].end, cues[i + 1].start - 0.02);
  }

  const srt = cues
    .filter((c) => c.end > c.start)
    .map((c, i) => `${i + 1}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.text}\n`)
    .join('\n');
  fs.writeFileSync(path.join(CAPTIONS, 'buzzys-senseational-adventure.en.srt'), `${srt}\n`);

  const vtt = ['WEBVTT', '', ...cues
    .filter((c) => c.end > c.start)
    .map((c, i) => `${i + 1}\n${timecode(c.start, '.')} --> ${timecode(c.end, '.')}\n${c.text}\n`)]
    .join('\n');
  fs.writeFileSync(path.join(CAPTIONS, 'buzzys-senseational-adventure.en.vtt'), `${vtt}\n`);

  return cues.length;
}

/* ------------------------------------------------------------------ *
 * Shot list and cue sheet
 * ------------------------------------------------------------------ */

function writeShotList() {
  const sceneName = new Map(project.scenes.map((s) => [s.id, s.name]));
  const rows = [['#', 'Start', 'Dur', 'Scene', 'Framing', 'Move', 'Transition', 'Note']];
  project.sequence.forEach((shot, i) => {
    rows.push([
      String(i + 1),
      timecode(shot.start).slice(3, 11),
      shot.duration.toFixed(2),
      sceneName.get(shot.sceneId) ?? shot.sceneId,
      shot.framing ?? 'camera',
      shot.move ?? 'static',
      shot.transitionIn?.type ?? 'cut',
      (shot.note ?? '').replace(/[\r\n]+/g, ' ').slice(0, 70),
    ]);
  });
  const csv = rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  fs.writeFileSync(path.join(DOCS, 'shot-list.csv'), `${csv}\n`);
  return project.sequence.length;
}

function writeCueSheet() {
  const rows = [['Start', 'Role', 'Duration', 'Source', 'Label']];
  for (const clip of [...project.audio].sort((a, b) => a.start - b.start)) {
    rows.push([
      timecode(clip.start).slice(3, 11),
      clip.role,
      clip.duration.toFixed(2),
      clip.src,
      (clip.label ?? '').replace(/[\r\n]+/g, ' ').slice(0, 70),
    ]);
  }
  for (const beat of project.interactions) {
    rows.push([timecode(beat.start).slice(3, 11), 'audience beat', beat.duration.toFixed(2), beat.kind, beat.prompt]);
  }
  rows.splice(1, 0, ...[]);
  const csv = rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  fs.writeFileSync(path.join(DOCS, 'cue-sheet.csv'), `${csv}\n`);
  return rows.length - 1;
}

/* ------------------------------------------------------------------ *
 * Blender import script
 * ------------------------------------------------------------------ */

function writeBlenderScript(scenes) {
  const lines = scenes.map((s) =>
    `    ("${s.file}", "${s.name.replace(/"/g, '\\"')}", ${s.start.toFixed(3)}, ${s.duration.toFixed(3)}),`,
  ).join('\n');

  const script = `# Import the whole film into Blender.
#
#   blender --python import_project.py
#
# or, inside Blender: Scripting -> Open -> import_project.py -> Run Script.
#
# Each scene arrives as its own collection, positioned on the timeline where it
# sits in the film, with its animation and its camera already baked in. The
# render settings match the delivered master (1920x1080 at ${FPS}fps).
#
# What is *not* in these files, and why:
#   - Particle effects (sparkles, petals, confetti) are simulated per frame in
#     the studio and have no glTF equivalent. Recreate them with Blender's own
#     particle system; the cue sheet lists where each one plays.
#   - The caption layer and the audience-participation overlays are composited
#     in 2D on top of the render. Add them in the video sequencer, or use the
#     supplied .srt.
#   - Audio is delivered as separate stems; load them into the sequencer from
#     deliverables/audio/.

import bpy
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = ${FPS}

SCENES = [
${lines}
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def setup_render():
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.resolution_x = ${project.meta.width}
    scene.render.resolution_y = ${project.meta.height}
    scene.render.resolution_percentage = 100
    scene.frame_start = 1
    scene.frame_end = int(${project.meta.duration.toFixed(3)} * FPS)
    # Flat, bright and unshadowed is closest to the studio's toon look; switch
    # to Cycles if you want to relight the film properly.
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [
        e.bl_idname for e in bpy.types.RenderEngine.__subclasses__()
    ] else "BLENDER_EEVEE"
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.62, 0.85, 1.0, 1.0)
        bg.inputs[1].default_value = 1.2


def import_scene(filename, name, start, duration):
    path = os.path.join(HERE, filename)
    if not os.path.exists(path):
        print("  missing:", path)
        return
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]

    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    for obj in imported:
        for existing in list(obj.users_collection):
            existing.objects.unlink(obj)
        collection.objects.link(obj)

    # Slide each scene's action to its place on the master timeline. Every glTF
    # starts its animation at zero, so without this the whole film plays on top
    # of itself.
    offset = int(round(start * FPS))
    for obj in imported:
        anim = obj.animation_data
        if anim and anim.action:
            for fcurve in anim.action.fcurves:
                for kp in fcurve.keyframe_points:
                    kp.co.x += offset
                    kp.handle_left.x += offset
                    kp.handle_right.x += offset
                fcurve.update()

    print(f"  {name}: {len(imported)} objects at frame {offset} ({duration:.1f}s)")


def main():
    clear_scene()
    setup_render()
    print("Importing", len(SCENES), "scenes")
    for filename, name, start, duration in SCENES:
        import_scene(filename, name, start, duration)
    print("Done. Timeline is", bpy.context.scene.frame_end, "frames.")


main()
`;
  fs.writeFileSync(path.join(SCENES, 'import_project.py'), script);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log(`\n  Exports for "${project.meta.title}" (${fmt(project.meta.duration)})\n`);

const cueCount = writeCaptions();
console.log(`    captions      ${cueCount} cues -> .srt and .vtt`);
const shotCount = writeShotList();
console.log(`    shot list     ${shotCount} shots -> shot-list.csv`);
const cues = writeCueSheet();
console.log(`    cue sheet     ${cues} entries -> cue-sheet.csv`);

if (SKIP_GLTF) {
  console.log('\n  Skipping glTF export (--no-gltf)\n');
  process.exit(0);
}

console.log('\n  Baking 3D scenes (this takes a minute per scene)…');
const studio = await openStudio({ verbose: true });
await studio.page.evaluate((p) => window.bloom.loadProject(p), project);

const exported = [];
for (const scene of project.scenes) {
  const t0 = Date.now();
  const result = await studio.page.evaluate(
    async (id) => window.bloom.exportSceneGLB(id, { fps: 24, camera: true }),
    scene.id,
  );
  const file = `${scene.id}.glb`;
  fs.writeFileSync(path.join(SCENES, file), Buffer.from(result.base64, 'base64'));
  exported.push({ file, name: result.name, start: result.start, duration: result.duration });
  console.log(
    `    ${scene.name.padEnd(24)} ${(result.bytes / 1024 / 1024).toFixed(1)} MB  ` +
    `${result.frames} frames  ${result.keyCount.toLocaleString()} keys  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}
await studio.close();

writeBlenderScript(exported);
console.log(`\n    blender       ${exported.length} .glb scenes + import_project.py`);
console.log('');
