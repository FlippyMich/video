"""
A small synthesiser for the studio's music and sound effects.

Everything is generated from first principles — oscillators, envelopes, a
Karplus-Strong string and a Schroeder reverb — so the project ships with a
complete, licence-free audio bed and no sample library to download.

The aim is not realism. It is the bright, uncluttered, mid-forward sound that
sits under children's television without competing with the voice: few voices at
once, short decays, and nothing below about 80Hz that would muddy a phone
speaker.
"""

from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 44100


# --------------------------------------------------------------------------- #
# Note helpers
# --------------------------------------------------------------------------- #

NOTE_OFFSETS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name: str) -> int:
    """`"C4"` -> 60. Accepts `#` and `b`."""
    i = 1
    acc = 0
    while i < len(name) and name[i] in "#b":
        acc += 1 if name[i] == "#" else -1
        i += 1
    return NOTE_OFFSETS[name[0].upper()] + acc + (int(name[i:]) + 1) * 12


def hz(note) -> float:
    n = midi(note) if isinstance(note, str) else note
    return 440.0 * 2 ** ((n - 69) / 12)


# Scale degrees for the modes we use. Major and pentatonic only: children's
# music lives almost entirely in consonance, and a stray minor second under a
# narration track is instantly noticeable.
MAJOR = [0, 2, 4, 5, 7, 9, 11]
PENTATONIC = [0, 2, 4, 7, 9]


def chord(root: int, quality: str = "maj") -> list[int]:
    if quality == "maj":
        return [root, root + 4, root + 7]
    if quality == "min":
        return [root, root + 3, root + 7]
    if quality == "maj7":
        return [root, root + 4, root + 7, root + 11]
    if quality == "sus4":
        return [root, root + 5, root + 7]
    if quality == "add9":
        return [root, root + 4, root + 7, root + 14]
    return [root, root + 4, root + 7]


# --------------------------------------------------------------------------- #
# Envelopes
# --------------------------------------------------------------------------- #

def adsr(n: int, attack=0.01, decay=0.12, sustain=0.6, release=0.25) -> np.ndarray:
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    r = max(1, int(release * SR))
    s = max(0, n - a - d - r)
    env = np.concatenate([
        np.linspace(0, 1, a, endpoint=False),
        np.linspace(1, sustain, d, endpoint=False),
        np.full(s, sustain),
        np.linspace(sustain, 0, r),
    ])
    return env[:n] if len(env) >= n else np.pad(env, (0, n - len(env)))


def perc_env(n: int, attack=0.004, decay=0.5, curve=4.0) -> np.ndarray:
    """Sharp attack, exponential fall. The envelope of anything struck."""
    a = max(1, int(attack * SR))
    env = np.empty(n)
    env[:a] = np.linspace(0, 1, a)
    tail = np.arange(n - a) / SR
    env[a:] = np.exp(-curve * tail / max(1e-4, decay))
    return env


# --------------------------------------------------------------------------- #
# Voices
# --------------------------------------------------------------------------- #

def _phase(freq: float, n: int, vibrato=0.0, vrate=5.0) -> np.ndarray:
    t = np.arange(n) / SR
    f = freq
    if vibrato:
        f = freq * (1 + vibrato * np.sin(2 * np.pi * vrate * t))
    return 2 * np.pi * np.cumsum(f) / SR


def bell(freq: float, dur: float, amp=0.5, decay=None) -> np.ndarray:
    """Glockenspiel/celeste: inharmonic partials, long shimmer."""
    n = int(dur * SR)
    decay = decay or dur * 0.8
    out = np.zeros(n)
    # Ratios roughly follow a struck bar; the 2.76 partial is what makes it
    # read as metal rather than as a sine.
    for ratio, gain, dscale in ((1.0, 1.0, 1.0), (2.76, 0.42, 0.55), (5.4, 0.18, 0.32), (8.9, 0.07, 0.2)):
        p = _phase(freq * ratio, n)
        out += gain * np.sin(p) * perc_env(n, 0.002, decay * dscale, 3.5)
    return out * amp / 1.7


def marimba(freq: float, dur: float, amp=0.5) -> np.ndarray:
    n = int(dur * SR)
    out = np.zeros(n)
    for ratio, gain, d in ((1.0, 1.0, 1.0), (4.0, 0.28, 0.35), (10.0, 0.08, 0.16)):
        out += gain * np.sin(_phase(freq * ratio, n)) * perc_env(n, 0.003, dur * 0.55 * d, 5.0)
    return out * amp / 1.36


def pluck(freq: float, dur: float, amp=0.5, damping=0.5) -> np.ndarray:
    """Karplus-Strong. A guitar/harp for the cost of a delay line."""
    n = int(dur * SR)
    period = max(2, int(SR / freq))
    rng = np.random.default_rng(int(freq * 100) % 99991)
    buf = rng.uniform(-1, 1, period)
    # A gentle low-pass on the excitation stops the attack sounding like static.
    buf = np.convolve(buf, [0.25, 0.5, 0.25], mode="same")
    # The classic loop is: emit the oldest sample, then write back the average
    # of it and its neighbour. Expressed as a filter that is an excitation
    # burst through y[n] = 0.5*g*(y[n-p] + y[n-p-1]).
    g = 0.988 - 0.02 * damping
    excite = np.zeros(n)
    excite[:period] = buf[:period]
    den = np.zeros(period + 2)
    den[0] = 1.0
    den[period] = -0.5 * g
    den[period + 1] = -0.5 * g
    out = lfilter([1.0], den, excite)
    return out * perc_env(n, 0.001, dur * 0.7, 2.2) * amp


def pad(freq: float, dur: float, amp=0.3, detune=0.006) -> np.ndarray:
    """Warm sustained bed. Three detuned saws, heavily filtered."""
    n = int(dur * SR)
    out = np.zeros(n)
    for k, d in enumerate((-detune, 0.0, detune)):
        p = _phase(freq * (1 + d), n, vibrato=0.0015, vrate=4.2 + k)
        saw = 2 * (p / (2 * np.pi) % 1.0) - 1
        out += saw
    out /= 3
    out = lowpass(out, 1400)
    return out * adsr(n, 0.35, 0.4, 0.75, 0.6) * amp


def bass(freq: float, dur: float, amp=0.45) -> np.ndarray:
    n = int(dur * SR)
    p = _phase(freq, n)
    tone = np.sin(p) + 0.22 * np.sin(2 * p)
    return tone * perc_env(n, 0.006, dur * 0.6, 3.0) * amp / 1.22


def kick(dur=0.28, amp=0.7) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Pitch sweep from 110Hz down to 45Hz — the classic synthesised kick.
    f = 45 + 65 * np.exp(-24 * t)
    p = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(p) * perc_env(n, 0.001, dur * 0.4, 5.0) * amp


def shaker(dur=0.12, amp=0.22, seed=1) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, n)
    # Narrow band well above the voice: present, but nothing to fight with.
    return bandpass(noise, 6000, 11000) * perc_env(n, 0.002, dur * 0.3, 8.0) * amp


def woodblock(freq=900.0, dur=0.14, amp=0.35) -> np.ndarray:
    n = int(dur * SR)
    tone = np.sin(_phase(freq, n)) + 0.5 * np.sin(_phase(freq * 1.6, n))
    return tone * perc_env(n, 0.001, dur * 0.25, 8.0) * amp / 1.5


# --------------------------------------------------------------------------- #
# Filters and space
# --------------------------------------------------------------------------- #

def _butter(cutoff: float, kind: str, order=4):
    return butter(order, min(0.99, cutoff / (SR / 2)), btype=kind, output="sos")


def lowpass(x: np.ndarray, cutoff: float, poles=4) -> np.ndarray:
    return sosfilt(_butter(cutoff, "low", poles), x)


def highpass(x: np.ndarray, cutoff: float, poles=4) -> np.ndarray:
    """
    A real Butterworth, not `x - lowpass(x)`.

    The subtractive version has a 6dB/octave skirt, which leaves most of the
    energy of a noise burst still in the signal — a "shaker" built that way is
    a broadband click that buries the whole arrangement under it.
    """
    return sosfilt(_butter(cutoff, "high", poles), x)


def bandpass(x: np.ndarray, low: float, high: float, poles=4) -> np.ndarray:
    return sosfilt(butter(poles, [low / (SR / 2), min(0.99, high / (SR / 2))],
                          btype="band", output="sos"), x)


def reverb(x: np.ndarray, room=0.6, mix=0.22) -> np.ndarray:
    """
    Schroeder reverb: four parallel combs into two allpasses.

    Convolution with a noise tail would sound better, but this is a few
    milliseconds of work on a whole cue and the result is a soft room rather
    than a cathedral, which is what a kids' mix wants.
    """
    out = np.zeros(len(x) + int(1.2 * SR))
    out[: len(x)] = x
    # Each comb is y[n] = x[n] + g*y[n-d], which is exactly a feedback filter
    # with d zeros in its denominator — so lfilter runs the whole recursion in
    # C rather than a Python loop over two million samples.
    comb_delays = [1116, 1188, 1277, 1356]
    comb_gains = [0.78 * room, 0.76 * room, 0.75 * room, 0.73 * room]
    wet = np.zeros_like(out)
    for d, g in zip(comb_delays, comb_gains):
        den = np.zeros(d + 1)
        den[0] = 1.0
        den[d] = -g
        wet += lfilter([1.0], den, out)
    wet /= 4
    # Allpass: y[n] = -g*x[n] + x[n-d] + g*y[n-d].
    for d, g in ((225, 0.5), (556, 0.5)):
        num = np.zeros(d + 1)
        num[0] = -g
        num[d] = 1.0
        den = np.zeros(d + 1)
        den[0] = 1.0
        den[d] = -g
        wet = lfilter(num, den, wet)
    return out + wet * mix


def echo(x: np.ndarray, delay=0.16, feedback=0.32, mix=0.3, taps=4) -> np.ndarray:
    d = int(delay * SR)
    out = np.zeros(len(x) + d * taps)
    out[: len(x)] = x
    g = mix
    for k in range(1, taps + 1):
        start = d * k
        out[start : start + len(x)] += x * g
        g *= feedback
    return out


# --------------------------------------------------------------------------- #
# Mixing
# --------------------------------------------------------------------------- #

@dataclass
class Track:
    """An accumulating buffer you can drop notes into at absolute times."""

    duration: float
    data: np.ndarray = field(init=False)

    def __post_init__(self):
        self.data = np.zeros(int(self.duration * SR) + SR)

    def add(self, at: float, sound: np.ndarray, gain=1.0, pan=0.0):
        i = int(at * SR)
        if i < 0:
            sound = sound[-i:]
            i = 0
        end = min(len(self.data), i + len(sound))
        if end <= i:
            return
        self.data[i:end] += sound[: end - i] * gain

    def finish(self, peak=0.86, fade_in=0.0, fade_out=0.0) -> np.ndarray:
        y = self.data[: int(self.duration * SR)]
        m = np.max(np.abs(y))
        if m > 1e-6:
            y = y * (peak / m)
        if fade_in:
            k = int(fade_in * SR)
            y[:k] *= np.linspace(0, 1, k)
        if fade_out:
            k = int(fade_out * SR)
            y[-k:] *= np.linspace(1, 0, k)
        return y


def soft_clip(x: np.ndarray, drive=1.0) -> np.ndarray:
    """Tanh limiting. Keeps transients from clicking without a real limiter."""
    return np.tanh(x * drive) / math.tanh(drive) if drive != 1.0 else np.tanh(x)


def write_wav(path: str, samples: np.ndarray, stereo=True):
    samples = np.clip(samples, -1.0, 1.0)
    data = (samples * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2 if stereo else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        if stereo:
            inter = np.empty(len(data) * 2, dtype="<i2")
            inter[0::2] = data
            inter[1::2] = data
            w.writeframes(inter.tobytes())
        else:
            w.writeframes(data.tobytes())


def duration_of(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()
