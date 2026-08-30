# How BloomStudio is built

Notes on the decisions that shaped the codebase, for anyone extending it.

## The project document

A film is one plain-JSON object (`src/engine/types.ts`). It holds scenes, a shot
sequence, audio clips, captions and audience beats, and nothing else — no
binaries, no references to anything outside itself except audio file paths.

Consequences that were worth designing for:

- A whole film is a few megabytes and can be emailed, diffed, or committed.
- Undo is a snapshot of the document. It is not clever, and it always restores
  exactly what you saw.
- The headless pipeline and the browser editor consume the identical file.

## Everything is generated

There are no `.glb`s, no textures and no font files. Characters, props and sets
are built from primitives by functions in `src/engine/assets/`.

The obvious cost is that a character is code rather than a model. The payoffs are
substantial:

- The library is instant, offline, and has no download step.
- A character is a readable, editable function.
- Sets are seeded, so "regenerate until you like it" is safe and reproducible.
- The repository has no third-party assets to license.

Text is drawn to a canvas and mapped onto a plane rather than extruded from a
font. That renders any script the browser can shape, stays sharp at any size, and
keeps the studio free of font files.

## Animation is a pure function of time

`SceneRuntime.update(t)` computes the state of the scene at `t` from the
keyframes. Nothing accumulates between frames — including the particle systems,
whose positions are a closed-form function of time and a per-particle seed.

This is the single most load-bearing decision in the engine:

- Scrubbing backwards is exact.
- The headless render produces the same pixels as the preview.
- Re-rendering a frame is idempotent, so a failed render can resume.

## Additive rig channels

Animation channels are *offsets from the rest pose*, not absolute values. That is
what lets action clips layer: a character can walk, wave and breathe at once
because the three clips write to different channels, or add into the same ones.

`mergeTracks` concatenates keys on shared channels and re-sorts; the evaluator
sums nothing explicitly, because layering falls out of the clips having been
authored as offsets in the first place.

## One renderer

`Player.render(t)` is called by the editor viewport, the in-browser exporter and
the production pipeline. There is no second code path, so the preview cannot
drift from the delivered file.

The 3D pass goes to a WebGL canvas; transitions, colour effects, captions and
the audience overlays are composited on a 2D canvas on top. Canvas2D compositing
is GPU-accelerated and can draw crisp text at any resolution, which a
post-processing shader chain would struggle with — and it costs far less.

## Framing is derived, not placed

A shot says "close-up on Buzzy, push in". The virtual director
(`src/engine/render/director.ts`) computes the camera from the subject's size and
the lens.

Beyond making the app usable by non-animators, this survives editing: move a
character and the shot is still a close-up on them. Hand-placed cameras are
supported as an escape hatch and are the exception.

Tight framings are measured in head-diameters rather than body-heights, because
on stylised characters a fraction of body height is not a stable measure of
anything.

## Performance notes

Numbers from this project, rendering at 1080p on a software rasteriser
(SwiftShader — a machine with a GPU is far faster):

| | |
|---|---|
| `toDataURL` per 1080p frame | ~490 ms |
| `toBlob` per 1080p frame | ~23 ms |
| Shadow pass at 2048² | more fill than the entire main pass |
| Full scene draw, shadows on | ~220 ms |
| Full scene draw, shadows off | ~120 ms |

Two of those shaped the pipeline: frames are captured with `toBlob` and POSTed
to a local server rather than serialised through the automation protocol, and
shadow map sizes are a per-quality-tier setting rather than a constant.

## Where to add things

| To add | Edit |
|---|---|
| A character | `src/engine/assets/characters.ts` — write a builder, add to `CHARACTERS` |
| A prop | `src/engine/assets/props.ts` — add a builder to `BUILDERS` and an entry to `PROPS` |
| A set | `src/engine/assets/environments.ts` — add a theme builder |
| An action | `src/engine/anim/clips.ts` — add a case to `bakeAction` and an entry to `ACTIONS` |
| A particle effect | `src/engine/fx/particles.ts` — add to `DEFAULTS` and `FX_LIST` |
| A shot type | `src/engine/render/director.ts` — add to `FRAMINGS` |
| A script directive | `src/engine/script/parser.ts`, then handle the beat in `builder.ts` |
| A house style | `src/engine/assets/palette.ts` — everything else reads from it |
