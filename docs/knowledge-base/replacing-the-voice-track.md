# Replacing the voice track

The film ships with a synthesised scratch track. Replacing it with real
recordings is a supported path through the pipeline, not a rebuild.

## What you're replacing

`deliverables/audio/vo/` holds one WAV per line, named
`NNN-speaker.wav` in script order:

```
001-buzzy.wav
002-buzzy.wav
003-lily.wav
...
```

`deliverables/audio/voice-timings.json` records, for each line, its duration,
where the speech starts inside the file, the phoneme sequence with timings, and
the text that was spoken. That file is what drives both the cut and the
lip-sync.

## The recording list

`deliverables/documents/voice-recording-list.csv` is the whole job in one file:
all 98 lines in order, each with the filename to save it under, the character,
the direction from the script, and the text.

| file | character | direction | line |
|---|---|---|---|
| `001-buzzy.wav` | BUZZY | excited | Hello, hello, HELLO, my friends! It's me — Buzzy! |
| `002-buzzy.wav` | BUZZY | happy | Welcome back to the garden! |

Hand it to whoever is recording, or feed the `line` column to a text-to-speech
service and save each result under the `file` name. Either way the rest is the
same.

Any format ffmpeg reads will do — the pipeline measures whatever it finds. Mono
or stereo, 44.1kHz or 48kHz, WAV or MP3 renamed to `.wav`; none of it matters as
long as the filenames match.

## The short version

1. Record each line as its own file.
2. Drop them into `deliverables/audio/vo/`, keeping the filenames.
3. Re-run the pipeline from stage 2.

```bash
node pipeline/02-project.mjs   # retimes the whole film around the new takes
node pipeline/05-mix.mjs       # rebuilds the stems and the mix
node pipeline/03-render.mjs    # re-renders the picture
```

The cut moves to fit the performance: if a line is now a second longer, the shot
holding it grows and everything after it slides along.

## Regenerating the timings

Stage 2 reads `voice-timings.json`, so that file has to describe the *new*
recordings. Two ways to get it:

**Keep the same text.** Re-run stage 1 with your files already in place and it
will measure them rather than synthesise over them — see the `--measure-only`
note at the top of `pipeline/01-voice.mjs`.

**Write it yourself.** The format is small:

```json
{
  "0:3": {
    "duration": 2.84,
    "offset": 0.06,
    "src": "audio/vo/001-buzzy.wav",
    "speaker": "BUZZY",
    "text": "Hello, hello, HELLO, my friends! It's me — Buzzy!",
    "phonemes": [
      { "phoneme": "h", "start": 0.00, "duration": 0.04 },
      { "phoneme": "@", "start": 0.04, "duration": 0.09 }
    ]
  }
}
```

The key is `sceneIndex:beatIndex`, counting scenes and beats in the script from
zero. `offset` trims silence off the head of the file. `phonemes` is optional —
without it the studio falls back to generating mouth shapes from the text, which
is noticeably less accurate but perfectly watchable.

## Getting phoneme timings

Any forced aligner will produce them. Two that work well:

- **Montreal Forced Aligner** — give it the audio and the text, convert its
  TextGrid output to the JSON above.
- **Whisper with word timestamps** — coarser (words, not phonemes), but the
  studio can distribute phonemes within a word, and the result is close.

Either is a meaningful upgrade on text-driven sync, especially on long vowels
and held notes.

## Direction notes for a voice artist

The script is written for a warm, unhurried, slightly heightened read — closer
to a nursery teacher than to a cartoon. Specifically:

- **Buzzy** carries the show and talks *to* the audience, not about them. Bright
  and quick, but never shrill. On the audience beats, ask the question and then
  genuinely stop.
- **Lily** is a child who is finding things out in real time. Her lines should
  sound like discoveries, not like answers she already had.
- **Dotty** is the comic relief — small, fussy, and very committed. The lemon
  reaction is the biggest moment in the film; let it be too big.
- **Pip** is tiny and fast. Barely more than a chirp.

Leave the pauses where the script leaves them. The gaps between lines are timed
for a four-year-old to catch up, and filling them makes the film harder to
follow, not livelier.
