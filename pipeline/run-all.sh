#!/usr/bin/env bash
#
# Produce every deliverable for "Buzzy's Sense-ational Adventure!" from the
# script.
#
# Stages are independent and re-runnable. The two picture renders dominate the
# wall-clock time — around an hour each on a machine without a GPU — so they run
# last and can be skipped while you iterate on everything else.
#
#   bash pipeline/run-all.sh              # everything
#   bash pipeline/run-all.sh --no-render  # skip the two picture renders
#   bash pipeline/run-all.sh --keep-voice # keep existing recordings, just measure them
#
set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_RENDER=0
KEEP_VOICE=0
for arg in "$@"; do
  case "$arg" in
    --no-render) SKIP_RENDER=1 ;;
    --keep-voice) KEEP_VOICE=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$1"; }

# --- preflight ------------------------------------------------------------
missing=()
for tool in node ffmpeg espeak-ng python3; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
python3 -c 'import numpy, scipy' 2>/dev/null || missing+=("python: numpy and scipy")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing prerequisites: ${missing[*]}" >&2
  echo "See README.md — the studio itself needs none of these, only the pipeline does." >&2
  exit 1
fi

say "Building the studio"
npm run build --silent

say "1/7  Recording the voice track"
if [ "$KEEP_VOICE" = "1" ]; then
  node pipeline/01-voice.mjs --measure-only
else
  node pipeline/01-voice.mjs
fi

say "2/7  Building the film from the script"
node pipeline/02-project.mjs

say "3/7  Synthesising music and sound effects"
python3 pipeline/04-audio.py

say "4/7  Mixing"
node pipeline/05-mix.mjs

say "5/7  Captions, 3D scenes and paperwork"
node pipeline/06-exports.mjs

say "6/7  The final script document"
node pipeline/07-script-doc.mjs

if [ "$SKIP_RENDER" = "1" ]; then
  say "Skipping the picture renders (--no-render)"
else
  say "7/7  Rendering the master (this is the slow one)"
  node pipeline/03-render.mjs

  say "     Rendering the green-screen version"
  node pipeline/03-render.mjs --green

  say "     Muxing the audio onto the picture"
  node pipeline/08-deliver.mjs
fi

say "Done"
echo
find deliverables -maxdepth 2 -type d | sort | sed 's/^/  /'
echo
