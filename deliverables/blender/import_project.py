# Import the whole film into Blender.
#
#   blender --python import_project.py
#
# or, inside Blender: Scripting -> Open -> import_project.py -> Run Script.
#
# Each scene arrives as its own collection, positioned on the timeline where it
# sits in the film, with its animation and its camera already baked in. The
# render settings match the delivered master (1920x1080 at 30fps).
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
FPS = 30

SCENES = [
    ("scene-title.glb", "Title card", 0.000, 5.500),
    ("scene-1.glb", "The Garden Gate", 5.500, 62.600),
    ("scene-2.glb", "Sense One — Seeing", 68.300, 73.167),
    ("scene-3.glb", "Sense Two — Hearing", 141.667, 77.300),
    ("scene-4.glb", "Sense Three — Smelling", 219.167, 56.733),
    ("scene-5.glb", "Sense Four — Tasting", 276.100, 49.933),
    ("scene-6.glb", "Sense Five — Touching", 326.233, 56.500),
    ("scene-7.glb", "The Five Senses Song", 382.900, 81.933),
    ("scene-outro.glb", "Outro", 465.023, 7.000),
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
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.frame_start = 1
    scene.frame_end = int(472.033 * FPS)
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
