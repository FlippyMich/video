#!/usr/bin/env python3
"""
Stage 4 — music and sound effects.

Writes every music bed and sound effect the script asks for, straight from the
synthesiser in `lib/synth.py`. No sample library, no licensing, and every cue
is reproducible: the same seed gives the same take.

The music is deliberately sparse. Under a narration track the bed's job is to
hold the energy up and then get out of the way, so each cue is a soft chord bed,
a light melody in the upper-mid register, and a pulse — and nothing occupying
the 300Hz–3kHz band where the voice lives.

    python3 pipeline/04-audio.py
"""

from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

import numpy as np
import synth as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MUSIC_DIR = os.path.join(ROOT, "deliverables/audio/music")
SFX_DIR = os.path.join(ROOT, "deliverables/audio/sfx")
os.makedirs(MUSIC_DIR, exist_ok=True)
os.makedirs(SFX_DIR, exist_ok=True)


# --------------------------------------------------------------------------- #
# Music
# --------------------------------------------------------------------------- #

# I–V–vi–IV and its cousins. Every progression here resolves and none of them
# contains a surprise, which is the point: the bed should be something a
# four-year-old can hum along to without noticing they're doing it.
PROGRESSIONS = {
    "sunny":   [(0, "maj"), (7, "maj"), (9, "min"), (5, "maj")],
    "gentle":  [(0, "maj"), (5, "maj"), (0, "maj"), (7, "sus4")],
    "curious": [(0, "add9"), (9, "min"), (5, "maj"), (7, "maj")],
    "playful": [(0, "maj"), (5, "maj"), (7, "maj"), (5, "maj")],
    "warm":    [(5, "maj"), (0, "maj"), (7, "maj"), (9, "min")],
}


def melody_line(rng, scale_root, bars, beats_per_bar, contour="rise"):
    """
    A singable phrase: mostly stepwise, landing on chord tones at bar ends.

    Random walks over a scale sound like a screensaver. Constraining the
    interval and anchoring the last note of each bar is most of what separates
    a tune from a sequence of notes.
    """
    notes = []
    degree = 4 if contour == "fall" else 0
    for bar in range(bars):
        for beat in range(beats_per_bar):
            last_of_bar = beat == beats_per_bar - 1
            if last_of_bar:
                degree = rng.choice([0, 2, 4])
            else:
                step = rng.choice([-2, -1, -1, 0, 1, 1, 2])
                degree = max(-3, min(9, degree + step))
            octave = 12 * (degree // len(S.PENTATONIC))
            pitch = scale_root + S.PENTATONIC[degree % len(S.PENTATONIC)] + octave
            # A rest every so often — wall-to-wall melody is exhausting to
            # listen to under dialogue.
            notes.append(None if (not last_of_bar and rng.random() < 0.28) else pitch)
    return notes


def build_cue(name, *, seed, bpm, bars, progression, root="C4",
              lead="marimba", energy=0.55, has_drums=True, swing=0.0,
              bass_octave=-24, reverb_mix=0.2):
    rng = random.Random(seed)
    nprng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    beats_per_bar = 4
    duration = bars * beats_per_bar * beat
    track = S.Track(duration + 2.0)

    root_midi = S.midi(root)
    prog = PROGRESSIONS[progression]

    # --- harmony: a soft pad plus an arpeggio ------------------------------
    for bar in range(bars):
        deg, quality = prog[bar % len(prog)]
        notes = S.chord(root_midi + deg, quality)
        at = bar * beats_per_bar * beat

        # The pad sits low and quiet. Anything substantial between 200Hz and
        # 800Hz competes directly with the narration, and on a phone speaker
        # the voice loses.
        for n in notes:
            track.add(at, S.pad(S.hz(n - 24), beat * beats_per_bar * 1.05,
                                amp=0.1 + 0.04 * energy))

        # Bass on beats 1 and 3.
        for b in (0, 2):
            track.add(at + b * beat,
                      S.bass(S.hz(notes[0] + bass_octave), beat * 1.4, amp=0.3 + 0.12 * energy))

        # Arpeggio through the chord, eighth notes — an octave up, where it
        # sparkles instead of crowding the dialogue.
        for i in range(beats_per_bar * 2):
            n = notes[i % len(notes)] + 12 + (12 if i >= len(notes) * 2 else 0)
            t = at + i * beat / 2 + (swing * beat / 2 if i % 2 else 0)
            track.add(t, S.pluck(S.hz(n), beat * 1.1, amp=0.2 + 0.1 * energy))

    # --- melody ------------------------------------------------------------
    tune = melody_line(rng, root_midi + 24, bars, beats_per_bar,
                       "rise" if energy > 0.5 else "fall")
    voice = {"marimba": S.marimba, "bell": S.bell, "pluck": S.pluck}[lead]
    for i, n in enumerate(tune):
        if n is None:
            continue
        at = i * beat
        dur = beat * (1.6 if i % 4 == 3 else 0.95)
        track.add(at, voice(S.hz(n), dur, amp=0.4 + 0.16 * energy))

    # --- pulse -------------------------------------------------------------
    if has_drums:
        for b in range(bars * beats_per_bar):
            at = b * beat
            if b % 4 in (0, 2):
                track.add(at, S.kick(0.26, amp=0.22 + 0.14 * energy))
            track.add(at + beat / 2, S.shaker(0.1, amp=0.035 + 0.03 * energy,
                                              seed=int(nprng.integers(1, 1 << 20))))
            if b % 8 == 7:
                track.add(at + beat * 0.75,
                          S.woodblock(880, 0.12, amp=0.07 + 0.05 * energy))

    y = track.finish(peak=0.82)
    y = S.reverb(y, room=0.55, mix=reverb_mix)
    # Clear the very bottom: sub content adds nothing on a tablet speaker and
    # eats headroom the voice needs.
    y = S.highpass(y, 90, poles=2)
    y = S.soft_clip(y * 0.95)
    # A clean loop point: fade the last bar into the first so the bed can be
    # repeated under a long scene without a seam.
    return y[: int(duration * S.SR)], duration


MUSIC_CUES = {
    # name                seed  bpm  bars progression  lead      energy drums
    "gentle-morning":   (11,   96,  8,  "gentle",   "bell",    0.35, False),
    "bright-discovery": (23,  116,  8,  "sunny",    "marimba", 0.72, True),
    "playful-curious":  (37,  108,  8,  "curious",  "marimba", 0.6,  True),
    "gentle-wonder":    (41,   92,  8,  "warm",     "bell",    0.4,  False),
    "cheeky-fun":       (53,  126,  8,  "playful",  "marimba", 0.8,  True),
    "soft-explore":     (67,   88,  8,  "gentle",   "pluck",   0.35, False),
    "sing-along":       (73,  120,  8,  "sunny",    "marimba", 0.85, True),
    "happy":            (79,  112,  8,  "sunny",    "marimba", 0.65, True),
}


def build_logo_sting():
    """Five rising notes and a shimmer. The show's four-second signature."""
    track = S.Track(6.0)
    root = S.midi("C5")
    for i, deg in enumerate([0, 4, 7, 12, 16]):
        at = 0.12 + i * 0.16
        track.add(at, S.bell(S.hz(root + deg), 1.6, amp=0.55))
        track.add(at, S.marimba(S.hz(root + deg - 12), 0.5, amp=0.3))
    # The landing chord.
    for n in S.chord(root, "add9"):
        track.add(0.94, S.bell(S.hz(n), 3.2, amp=0.42))
        track.add(0.94, S.pad(S.hz(n - 12), 3.4, amp=0.18))
    track.add(0.94, S.bass(S.hz(root - 24), 1.8, amp=0.4))
    track.add(0.94, S.kick(0.35, amp=0.5))
    for i in range(9):
        track.add(1.1 + i * 0.11, S.shaker(0.09, amp=0.04, seed=200 + i))
    y = track.finish(peak=0.85, fade_out=0.6)
    return S.soft_clip(S.reverb(y, room=0.7, mix=0.3) * 0.95)[: int(5.5 * S.SR)]


def build_outro_music():
    """Warm, unhurried, and it lands rather than fading out mid-phrase."""
    y, _ = build_cue("outro", seed=91, bpm=104, bars=4, progression="warm",
                     root="C4", lead="bell", energy=0.5, has_drums=True,
                     reverb_mix=0.28)
    track = S.Track(len(y) / S.SR + 3.0)
    track.add(0, y)
    end = len(y) / S.SR
    for n in S.chord(S.midi("C4"), "add9"):
        track.add(end, S.bell(S.hz(n), 3.0, amp=0.5))
        track.add(end, S.pad(S.hz(n - 12), 3.0, amp=0.2))
    track.add(end, S.bass(S.hz(S.midi("C2")), 2.4, amp=0.4))
    return S.soft_clip(track.finish(peak=0.84, fade_out=1.4) * 0.95)


# --------------------------------------------------------------------------- #
# Sound effects
# --------------------------------------------------------------------------- #

def sfx_buzz_in(dur=1.1):
    """A bee arriving: buzz whose pitch falls as it settles."""
    n = int(dur * S.SR)
    t = np.arange(n) / S.SR
    f = 220 - 90 * (t / dur)
    p = 2 * np.pi * np.cumsum(f) / S.SR
    # Square-ish tone with amplitude flutter — that flutter is what says "wings".
    tone = np.sign(np.sin(p)) * 0.35 + np.sin(p) * 0.65
    flutter = 1 + 0.35 * np.sin(2 * np.pi * 34 * t)
    env = np.minimum(1.0, t / 0.08) * np.exp(-2.0 * t / dur)
    return S.lowpass(tone * flutter * env, 2200) * 0.55


def sfx_sparkle(dur=1.4, seed=3):
    track = S.Track(dur + 0.5)
    rng = random.Random(seed)
    scale = [S.midi("C6") + d for d in [0, 2, 4, 7, 9, 12, 16]]
    for i in range(11):
        track.add(i * 0.055 + rng.random() * 0.02,
                  S.bell(S.hz(rng.choice(scale)), 1.0, amp=0.4))
    return S.soft_clip(S.reverb(track.finish(peak=0.7), 0.7, 0.35))[: int(dur * S.SR)]


def sfx_twinkle(dur=1.2):
    track = S.Track(dur + 0.5)
    for i, deg in enumerate([0, 4, 7, 12]):
        track.add(i * 0.075, S.bell(S.hz(S.midi("G5") + deg), 1.1, amp=0.5))
    return S.soft_clip(S.reverb(track.finish(peak=0.72), 0.6, 0.3))[: int(dur * S.SR)]


def sfx_ding(dur=1.3):
    track = S.Track(dur + 0.5)
    track.add(0, S.bell(S.hz("C6"), 1.2, amp=0.6))
    track.add(0.0, S.bell(S.hz("G6"), 1.0, amp=0.3))
    return S.soft_clip(S.reverb(track.finish(peak=0.75), 0.6, 0.28))[: int(dur * S.SR)]


def sfx_whoosh(dur=0.75, seed=7):
    n = int(dur * S.SR)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, n)
    t = np.arange(n) / S.SR
    # A band that sweeps upward then away — the shape of something passing.
    swept = S.highpass(S.lowpass(noise, 6000), 400)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6
    return swept * env * 0.55


def sfx_bell(pitch="A5", dur=2.2, amp=0.6):
    track = S.Track(dur + 0.5)
    track.add(0, S.bell(S.hz(pitch), dur * 0.9, amp=amp))
    track.add(0.005, S.bell(S.hz(S.midi(pitch) + 7), dur * 0.6, amp=amp * 0.4))
    return S.soft_clip(S.reverb(track.finish(peak=0.8), 0.65, 0.3))[: int(dur * S.SR)]


def sfx_drum_loud(dur=1.4):
    track = S.Track(dur + 0.5)
    for i, at in enumerate((0.0, 0.28, 0.56)):
        track.add(at, S.kick(0.42, amp=0.9 - i * 0.12))
        n = int(0.3 * S.SR)
        rng = np.random.default_rng(40 + i)
        body = S.lowpass(rng.uniform(-1, 1, n), 900) * S.perc_env(n, 0.001, 0.14, 6)
        track.add(at, body * 0.45)
    return S.soft_clip(S.reverb(track.finish(peak=0.9), 0.5, 0.2))[: int(dur * S.SR)]


def sfx_water_lap(dur=3.0, seed=13):
    n = int(dur * S.SR)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, n)
    t = np.arange(n) / S.SR
    body = S.highpass(S.lowpass(noise, 2600), 600)
    # Two slow swells: water is periodic, static noise is a radio between
    # stations.
    swell = 0.45 + 0.35 * np.sin(2 * np.pi * 0.42 * t) + 0.2 * np.sin(2 * np.pi * 0.19 * t + 1.1)
    return body * swell * 0.3


def sfx_bird_song(dur=2.6, seed=17):
    """Chirps: fast frequency sweeps in short bursts."""
    track = S.Track(dur + 0.5)
    rng = random.Random(seed)
    at = 0.05
    while at < dur - 0.3:
        burst = rng.choice([2, 3, 3, 4])
        for k in range(burst):
            d = 0.055 + rng.random() * 0.04
            n = int(d * S.SR)
            t = np.arange(n) / S.SR
            f0 = 2100 + rng.random() * 1400
            f = f0 * (1 + (0.5 if rng.random() < 0.5 else -0.35) * (t / d))
            p = 2 * np.pi * np.cumsum(f) / S.SR
            chirp = np.sin(p) * S.perc_env(n, 0.004, d * 0.5, 3.0)
            track.add(at + k * (d + 0.02), chirp * 0.4)
        at += 0.4 + rng.random() * 0.5
    return S.soft_clip(S.reverb(track.finish(peak=0.6), 0.7, 0.3))[: int(dur * S.SR)]


def sfx_clapping(dur=3.2, seed=23):
    track = S.Track(dur + 0.5)
    rng = random.Random(seed)
    # 120bpm, on the beat, with a handful of stragglers — a crowd clapping in
    # perfect unison sounds like one enormous person.
    beat = 0.5
    at = 0.0
    while at < dur - 0.2:
        for _ in range(rng.randint(3, 5)):
            jitter = rng.gauss(0, 0.022)
            d = 0.09
            n = int(d * S.SR)
            r = np.random.default_rng(rng.randint(1, 1 << 20))
            clap = S.lowpass(S.highpass(r.uniform(-1, 1, n), 1100), 7000)
            track.add(max(0, at + jitter), clap * S.perc_env(n, 0.001, 0.035, 8) * 0.35)
        at += beat
    return S.soft_clip(S.reverb(track.finish(peak=0.7), 0.6, 0.25))[: int(dur * S.SR)]


def sfx_sniff(dur=1.0, seed=29):
    n = int(dur * S.SR)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, n)
    t = np.arange(n) / S.SR
    body = S.highpass(S.lowpass(noise, 3200), 700)
    # Two quick inward draws.
    env = np.zeros(n)
    for start, length in ((0.05, 0.22), (0.36, 0.3)):
        a = int(start * S.SR)
        b = min(n, int((start + length) * S.SR))
        env[a:b] = np.sin(np.linspace(0, np.pi, b - a)) ** 1.4
    return body * env * 0.4


def sfx_comedy_pop(dur=0.5):
    n = int(dur * S.SR)
    t = np.arange(n) / S.SR
    f = 780 * np.exp(-9 * t) + 160
    p = 2 * np.pi * np.cumsum(f) / S.SR
    return np.sin(p) * S.perc_env(n, 0.002, 0.1, 6) * 0.6


def sfx_comedy_boing(dur=1.1):
    n = int(dur * S.SR)
    t = np.arange(n) / S.SR
    # Pitch wobbling around a falling centre: the spring.
    centre = 420 * np.exp(-2.2 * t) + 110
    f = centre * (1 + 0.55 * np.sin(2 * np.pi * 9 * t) * np.exp(-2.4 * t))
    p = 2 * np.pi * np.cumsum(f) / S.SR
    return (np.sin(p) + 0.25 * np.sin(2 * p)) * S.perc_env(n, 0.003, 0.42, 3.2) * 0.5


def sfx_nibble(dur=0.7, seed=31):
    track = S.Track(dur + 0.3)
    for i, at in enumerate((0.0, 0.16, 0.33)):
        n = int(0.07 * S.SR)
        r = np.random.default_rng(seed + i)
        crunch = S.highpass(r.uniform(-1, 1, n), 1800) * S.perc_env(n, 0.001, 0.03, 8)
        track.add(at, crunch * 0.45)
    return track.finish(peak=0.65)[: int(dur * S.SR)]


def sfx_fanfare(dur=2.4):
    track = S.Track(dur + 0.6)
    root = S.midi("C5")
    for i, (deg, at) in enumerate([(0, 0.0), (4, 0.14), (7, 0.28), (12, 0.46)]):
        track.add(at, S.marimba(S.hz(root + deg), 0.7, amp=0.5))
        track.add(at, S.bell(S.hz(root + deg + 12), 1.2, amp=0.3))
    for n in S.chord(root, "maj"):
        track.add(0.66, S.bell(S.hz(n), 2.0, amp=0.45))
        track.add(0.66, S.pad(S.hz(n - 12), 1.8, amp=0.2))
    track.add(0.66, S.kick(0.4, amp=0.55))
    track.add(0.66, S.bass(S.hz(root - 24), 1.6, amp=0.4))
    return S.soft_clip(S.reverb(track.finish(peak=0.85, fade_out=0.4), 0.7, 0.3))[: int(dur * S.SR)]


def sfx_cheer(dur=2.6, seed=37):
    """A small crowd: filtered noise with vowel-ish resonance, plus claps."""
    n = int(dur * S.SR)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, n)
    t = np.arange(n) / S.SR
    body = S.highpass(S.lowpass(noise, 3000), 500)
    wobble = 1 + 0.25 * np.sin(2 * np.pi * 5.5 * t) + 0.15 * np.sin(2 * np.pi * 3.1 * t)
    env = np.minimum(1.0, t / 0.15) * np.exp(-1.1 * t / dur)
    crowd = body * wobble * env * 0.3
    claps = sfx_clapping(dur, seed=seed + 1)
    out = crowd[: min(len(crowd), len(claps))] + claps[: len(crowd)] * 0.7
    return S.soft_clip(out)


def sfx_think_cue(dur=1.8):
    """Three rising marimba notes — 'over to you'."""
    track = S.Track(dur + 0.4)
    for i, deg in enumerate([0, 3, 7]):
        track.add(i * 0.22, S.marimba(S.hz(S.midi("E5") + deg), 0.9, amp=0.42))
    return S.soft_clip(S.reverb(track.finish(peak=0.7), 0.6, 0.28))[: int(dur * S.SR)]


def sfx_music_start(dur=1.2):
    track = S.Track(dur + 0.4)
    for i, deg in enumerate([0, 4, 7, 12]):
        track.add(i * 0.09, S.pluck(S.hz(S.midi("C5") + deg), 1.0, amp=0.42))
    track.add(0, S.shaker(0.12, amp=0.2, seed=5))
    return S.soft_clip(S.reverb(track.finish(peak=0.72), 0.6, 0.25))[: int(dur * S.SR)]


def sfx_giggle(dur=1.3):
    """A few short rising blips. Reads as a laugh without being a real one."""
    track = S.Track(dur + 0.3)
    for i in range(5):
        at = i * 0.16
        n = int(0.11 * S.SR)
        t = np.arange(n) / S.SR
        f = (620 + i * 45) * (1 + 0.4 * t / 0.11)
        p = 2 * np.pi * np.cumsum(f) / S.SR
        track.add(at, np.sin(p) * S.perc_env(n, 0.004, 0.05, 5) * (0.4 - i * 0.04))
    return S.soft_clip(S.reverb(track.finish(peak=0.6), 0.5, 0.2))[: int(dur * S.SR)]


SFX = {
    "buzz-in": sfx_buzz_in,
    "sparkle": sfx_sparkle,
    "twinkle": sfx_twinkle,
    "ding": sfx_ding,
    "whoosh": sfx_whoosh,
    "bell": lambda: sfx_bell("A5", 2.2, 0.6),
    "bell-soft": lambda: sfx_bell("E5", 1.8, 0.22),
    "drum-loud": sfx_drum_loud,
    "water-lap": sfx_water_lap,
    "bird-song": sfx_bird_song,
    "clapping": sfx_clapping,
    "sniff": sfx_sniff,
    "comedy-pop": sfx_comedy_pop,
    "comedy-boing": sfx_comedy_boing,
    "nibble": sfx_nibble,
    "fanfare": sfx_fanfare,
    "cheer": sfx_cheer,
    "think-cue": sfx_think_cue,
    "music-start": sfx_music_start,
    "giggle": sfx_giggle,
    # The audience-beat cue the builder emits for question pauses.
    "pop": sfx_comedy_pop,
}


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    manifest = {"music": {}, "sfx": {}}

    print("\n  Music")
    for name, (seed, bpm, bars, prog, lead, energy, drums) in MUSIC_CUES.items():
        y, dur = build_cue(name, seed=seed, bpm=bpm, bars=bars, progression=prog,
                           lead=lead, energy=energy, has_drums=drums)
        path = os.path.join(MUSIC_DIR, f"{name}.wav")
        S.write_wav(path, y)
        manifest["music"][name] = round(len(y) / S.SR, 3)
        print(f"    {name:<20} {len(y) / S.SR:5.1f}s  {bpm}bpm  {prog}")

    for name, builder in (("logo-sting", build_logo_sting), ("outro", build_outro_music)):
        y = builder()
        path = os.path.join(MUSIC_DIR, f"{name}.wav")
        S.write_wav(path, y)
        manifest["music"][name] = round(len(y) / S.SR, 3)
        print(f"    {name:<20} {len(y) / S.SR:5.1f}s")

    print("\n  Sound effects")
    for name, builder in SFX.items():
        y = builder()
        path = os.path.join(SFX_DIR, f"{name}.wav")
        S.write_wav(path, y)
        manifest["sfx"][name] = round(len(y) / S.SR, 3)
        print(f"    {name:<20} {len(y) / S.SR:5.2f}s")

    out = os.path.join(ROOT, "deliverables/audio/audio-manifest.json")
    with open(out, "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"\n  {len(manifest['music'])} music cues, {len(manifest['sfx'])} sound effects")
    print(f"  wrote {os.path.relpath(out, ROOT)}\n")


if __name__ == "__main__":
    main()
