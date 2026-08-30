# Writing a script BloomStudio understands

The format is closer to a rehearsal script than to a file format. It is meant to
be typed in Notepad by somebody who has never used an animation tool, and it is
forgiving: anything it cannot read becomes a stage direction rather than an
error.

The only thing that is actually required is dialogue.

---

## The whole format in one page

```
# Title: Buzzy's Sense-ational Adventure!
# Subtitle: Learning the five senses
# Fps: 30

## Scene: The Garden Gate | theme=garden time=morning weather=clear seed=7

@music: gentle-morning
[Buzzy flies in and waves with both hands]
BUZZY (excited): Hello, hello, HELLO, my friends!
?? Can you wave hello to Buzzy? | 3s | hand-icon | Hello!
@cam: close-up on BUZZY, push-in
LILY (curious): Buzzy! What are we doing today?
@sfx: sparkle
~~ crossfade 0.5
```

| Line starts with | Means |
|---|---|
| `#` | Document setting — Title, Subtitle, Author, Fps |
| `##` | A new scene |
| `NAME:` | Dialogue |
| `[ ]` | A stage direction |
| `??` | A pause for the audience |
| `@` | An instruction — sfx, music, cam, note |
| `~~` | A transition into the next shot |
| `//` | A comment, ignored |

---

## Dialogue

```
BUZZY: Hello!
BUZZY (excited): Hello!
BUZZY (excited, wave): Hello!
```

The name must be in capitals and end with a colon. Anything in brackets before
the colon is a note to the performer: emotion words set the expression, action
words trigger a gesture.

Emotions the studio recognises: *excited, happy, curious, surprised, thinking,
sad, worried, sleepy, giggling, proud, yucky*. If you don't give one, it is
guessed from the punctuation — a question mark reads as curious, two exclamation
marks as excited.

A line that starts in lower case and follows dialogue is treated as a
continuation of it, so you can break long speeches across lines.

## Stage directions

```
[Buzzy flies in and waves]
[Lily leans in and sniffs the flower]
[Dotty bites the lemon and pulls a face]
```

Written in plain English. The studio looks for verbs it knows — *wave, point,
present, clap, cheer, dance, spin, nod, shake head, think, shrug, lean in, look
around, sniff, listen, taste, touch, jump, hop, run, walk, fly, hover, land,
take off, sit, stand up, tiptoe, gasp, wag* — and plays the matching action on
whoever the line starts with.

Unrecognised directions are kept as notes on the shot. Nothing is lost, and
nothing breaks.

## Audience beats

```
?? Can you wave back?
?? Loud or quiet? | 3s | answer-pop | Quiet!
?? Sing along with me! | 5s | bouncing-ball
```

After the prompt, in any order: a hold length, an overlay, and the answer to
reveal.

Overlays: `hand-icon` (copy a gesture), `countdown` (a timer ring),
`bouncing-ball` (sing along), `answer-pop` (reveal the answer at the end),
`none`.

The kind of beat is inferred from the wording — "sing" makes a sing-along,
"count" or "how many" a count-along, "copy" or "touch your" a gesture beat —
which changes what the character does while it waits.

**On hold lengths.** Three seconds is right for a one-word answer, four for
something they have to look for, five or six for singing. If you are showing the
video to a group, pause it on the prompt: the built-in hold is a floor, not a
ceiling.

## Instructions

```
@music: gentle-morning
@sfx: bell
@cam: close-up on BUZZY, push-in
@note: remember to re-record this line
```

Music runs until the next music cue. Camera instructions override the automatic
cut for that line; framings are *wide, full, medium, close-up,
extreme-close-up, over-shoulder, two-shot, low-angle, high-angle*, and moves are
*push-in, pull-out, pan-left, pan-right, orbit, crane-up, handheld, follow,
static*.

## Scenes

```
## Scene: Sense Two — Hearing | theme=pond time=morning weather=clear seed=34
```

Everything after the `|` is optional:

- `theme` — garden, meadow, forest, pond, sky, classroom, kitchen, bedroom, void
- `time` — morning, noon, afternoon, sunset, night
- `weather` — clear, cloudy, rainbow
- `seed` — the number that decides the arrangement of the set
- `lighting` — overrides the automatic choice

If you leave `theme` out, it is guessed from the scene's name.

## Transitions

```
~~ crossfade 0.5
~~ fade to black 0.8
~~ cut
```

Also accepts screenplay style: `CUT TO:`, `FADE TO BLACK:`.

---

## What the studio decides for you

Everything you don't say:

- **Casting** — from the character's name. Buzzy is the bee, anything matching
  "bird", "chirp" or "pip" is the little bird, unrecognised names become
  children. Override any of it in the Script panel.
- **Staging** — speakers stand on a shallow arc facing the camera, turned
  slightly inward, with flying characters hovering.
- **Cameras** — a wide establishing shot at the top of each scene, then a cut
  whenever the speaker changes or a shot has run more than six seconds, cycling
  through framings so a long conversation doesn't flatten out.
- **Performance** — one gesture per line, chosen from the words; an idle sway
  and blinking under everything; everyone who isn't speaking turns to look at
  whoever is.
- **Lip-sync** — from the text, or from the audio once there is any.
- **Captions** — split at sentence boundaries, at most two lines of about forty
  characters, timed proportionally.

All of it is keyframes and shots afterwards. Change anything.

---

## Length

Roughly: **words ÷ 140 minutes**, plus about three and a half seconds per
audience beat, plus a second per scene for the establishing shot.

A seven-and-a-half-minute film is about 100 lines and 25 audience beats. If you
are aiming at a running time, write it long and cut — trimming lines is far
easier than finding more.
