/**
 * Facial expressions.
 *
 * Each expression is a small set of pose values that the face builder reads.
 * They blend additively with visemes: a character can be *surprised* and saying
 * "oh" at the same time, and the brows shouldn't fight the mouth.
 */

export type ExpressionId =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'surprised'
  | 'thinking'
  | 'sad'
  | 'worried'
  | 'sleepy'
  | 'giggling'
  | 'proud'
  | 'yucky';

export interface FacePose {
  /** -1 angry/furrowed … +1 raised/surprised. */
  browRaise: number;
  /** Inner-brow tilt: +1 sad, -1 stern. */
  browTilt: number;
  /** 0 wide open … 1 fully closed. */
  eyeClose: number;
  /** Extra eyelid lift for surprise. */
  eyeWide: number;
  /** Corner-of-mouth lift, -1 frown … +1 big smile. */
  smile: number;
  /** Baseline jaw drop the viseme adds on top of. */
  mouthOpen: number;
  /** Cheek colour strength. */
  blush: number;
  /** Head tilt in radians — a tiny cock of the head sells "curious". */
  headTilt: number;
}

export const NEUTRAL_FACE: FacePose = {
  browRaise: 0, browTilt: 0, eyeClose: 0, eyeWide: 0,
  smile: 0.15, mouthOpen: 0, blush: 0.25, headTilt: 0,
};

export const EXPRESSIONS: Record<ExpressionId, FacePose> = {
  neutral: NEUTRAL_FACE,
  happy: { ...NEUTRAL_FACE, browRaise: 0.2, smile: 0.8, blush: 0.4 },
  excited: { ...NEUTRAL_FACE, browRaise: 0.7, eyeWide: 0.5, smile: 1.0, mouthOpen: 0.35, blush: 0.6 },
  curious: { ...NEUTRAL_FACE, browRaise: 0.5, browTilt: 0.2, smile: 0.35, headTilt: 0.16 },
  surprised: { ...NEUTRAL_FACE, browRaise: 1.0, eyeWide: 1.0, smile: 0.1, mouthOpen: 0.55, blush: 0.3 },
  thinking: { ...NEUTRAL_FACE, browRaise: -0.15, browTilt: -0.25, eyeClose: 0.25, smile: 0.1, headTilt: 0.22 },
  sad: { ...NEUTRAL_FACE, browRaise: 0.1, browTilt: 0.9, eyeClose: 0.3, smile: -0.6, blush: 0.15 },
  worried: { ...NEUTRAL_FACE, browRaise: 0.35, browTilt: 0.6, eyeWide: 0.3, smile: -0.3 },
  sleepy: { ...NEUTRAL_FACE, browRaise: -0.1, eyeClose: 0.7, smile: 0.2, mouthOpen: 0.1, headTilt: 0.1 },
  giggling: { ...NEUTRAL_FACE, browRaise: 0.35, eyeClose: 0.75, smile: 1.0, mouthOpen: 0.3, blush: 0.75 },
  proud: { ...NEUTRAL_FACE, browRaise: 0.3, eyeClose: 0.2, smile: 0.7, blush: 0.45 },
  yucky: { ...NEUTRAL_FACE, browRaise: -0.4, browTilt: -0.3, eyeClose: 0.5, smile: -0.5, headTilt: -0.12 },
};

export const EXPRESSION_IDS = Object.keys(EXPRESSIONS) as ExpressionId[];

export const EXPRESSION_LABELS: Record<ExpressionId, string> = {
  neutral: 'Neutral',
  happy: 'Happy',
  excited: 'Excited',
  curious: 'Curious',
  surprised: 'Surprised',
  thinking: 'Thinking',
  sad: 'Sad',
  worried: 'Worried',
  sleepy: 'Sleepy',
  giggling: 'Giggling',
  proud: 'Proud',
  yucky: 'Yucky',
};

/** Weighted blend of expression poses, normalised so weights can't blow out. */
export function blendExpressions(weights: Partial<Record<ExpressionId, number>>): FacePose {
  const acc: FacePose = { browRaise: 0, browTilt: 0, eyeClose: 0, eyeWide: 0, smile: 0, mouthOpen: 0, blush: 0, headTilt: 0 };
  let total = 0;
  for (const id of EXPRESSION_IDS) {
    const w = weights[id] ?? 0;
    if (w <= 0.001) continue;
    const p = EXPRESSIONS[id];
    (Object.keys(acc) as (keyof FacePose)[]).forEach((k) => { acc[k] += p[k] * w; });
    total += w;
  }
  if (total <= 0.001) return { ...NEUTRAL_FACE };
  (Object.keys(acc) as (keyof FacePose)[]).forEach((k) => { acc[k] /= total; });
  return acc;
}

/**
 * A blink track. Real characters blink every 2–6 seconds; without it a face
 * reads as dead, and it's the single cheapest thing you can add to a rig.
 */
export function blinkKeys(
  duration: number,
  seed = 1,
  opts: { minGap?: number; maxGap?: number } = {},
): { t: number; v: number }[] {
  const minGap = opts.minGap ?? 2.0;
  const maxGap = opts.maxGap ?? 5.5;
  let s = seed * 9301 + 49297;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  const keys: { t: number; v: number }[] = [{ t: 0, v: 0 }];
  let t = 0.6 + rand() * 2;
  while (t < duration) {
    keys.push({ t: t - 0.06, v: 0 }, { t, v: 1 }, { t: t + 0.07, v: 0 });
    // Occasional double-blink — it's a small thing that reads as alive.
    if (rand() < 0.18) {
      t += 0.22;
      keys.push({ t: t - 0.06, v: 0 }, { t, v: 1 }, { t: t + 0.07, v: 0 });
    }
    t += minGap + rand() * (maxGap - minGap);
  }
  return keys;
}
