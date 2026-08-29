/**
 * The house style.
 *
 * Bright, high-chroma, low-contrast-between-neighbours — the palette range that
 * preschool animation lives in. Everything else in the asset library pulls from
 * here so a scene never ends up with two greens that fight.
 *
 * Swap this one file to re-skin the whole studio for a different show.
 */

export const PALETTE = {
  // Sunshine / honey
  honey: 0xffc23d,
  honeyDeep: 0xf2a015,
  butter: 0xffe38a,

  // Petals
  petalPink: 0xff8fb1,
  petalRose: 0xf65f8d,
  petalBlush: 0xffd0dd,
  petalPurple: 0xb07cf0,
  petalLavender: 0xd9c2ff,

  // Leaf & stem
  leaf: 0x62c46b,
  leafDeep: 0x36954a,
  leafLight: 0x9ee08a,
  stem: 0x4faa54,
  moss: 0x2f7d43,

  // Sky & water
  sky: 0x8fd8ff,
  skyDeep: 0x53b7f0,
  water: 0x63c6e8,
  waterDeep: 0x2f97c9,
  cloud: 0xffffff,
  cloudShade: 0xe4f1ff,

  // Earth
  soil: 0xa9714b,
  soilDeep: 0x7d5133,
  bark: 0x99623c,
  barkDeep: 0x6f4527,
  sand: 0xf2ddb0,

  // Fruit & food
  strawberry: 0xf5455c,
  orange: 0xff9540,
  lemon: 0xffe14d,
  berry: 0x8f5cd6,
  mint: 0x88e6c0,

  // Skin tones — a range, because the classroom should look like a classroom
  skin1: 0xffdcc0,
  skin2: 0xf5c39a,
  skin3: 0xe0a878,
  skin4: 0xbf8256,
  skin5: 0x8d5a3b,
  skin6: 0x63402c,

  // Hair
  hairBrown: 0x6b432a,
  hairBlack: 0x2e2622,
  hairBlonde: 0xf0cf7c,
  hairRed: 0xd1673a,
  hairGrey: 0xc9c3bd,

  // Neutrals & UI-in-world
  white: 0xffffff,
  offWhite: 0xfff8ec,
  charcoal: 0x3a3340,
  eyeWhite: 0xfffdf8,
  iris: 0x3f2d5c,
  mouthInner: 0x8c3550,
  tongue: 0xf07a9a,
  teeth: 0xfffdf6,
  blush: 0xff9db4,

  // Classroom
  chalkboard: 0x2f5d4e,
  wood: 0xc99a5e,
  woodDeep: 0x9a7141,
  paper: 0xfffcf2,
  plastic: 0x5fb3e8,

  // Chroma key green — the exact shade keyers expect
  chromaGreen: 0x00b140,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Named palettes the character builder uses so each cast member is distinct. */
export const CHARACTER_PALETTES = {
  bee: { body: PALETTE.honey, stripe: PALETTE.charcoal, accent: PALETTE.honeyDeep, wing: 0xdff2ff },
  ladybird: { body: PALETTE.strawberry, stripe: PALETTE.charcoal, accent: 0xd63347, wing: 0xffd9de },
  butterfly: { body: PALETTE.petalPurple, stripe: PALETTE.petalLavender, accent: PALETTE.petalPink, wing: PALETTE.petalPink },
  puppy: { body: 0xe8c48a, stripe: 0xc79a5f, accent: PALETTE.charcoal, wing: PALETTE.white },
  kitten: { body: 0xb9b3c9, stripe: 0x8a83a0, accent: PALETTE.petalPink, wing: PALETTE.white },
  bunny: { body: 0xfff2e4, stripe: 0xe8d4c2, accent: PALETTE.petalPink, wing: PALETTE.white },
  bird: { body: PALETTE.skyDeep, stripe: PALETTE.sky, accent: PALETTE.orange, wing: PALETTE.sky },
  frog: { body: PALETTE.leaf, stripe: PALETTE.leafLight, accent: PALETTE.petalPink, wing: PALETTE.white },
  cloud: { body: PALETTE.white, stripe: PALETTE.cloudShade, accent: PALETTE.sky, wing: PALETTE.white },
  caterpillar: { body: PALETTE.leafLight, stripe: PALETTE.leaf, accent: PALETTE.petalPink, wing: PALETTE.white },
  fish: { body: PALETTE.orange, stripe: PALETTE.lemon, accent: PALETTE.white, wing: PALETTE.butter },
} as const;

/**
 * Colours that read as "the same object, lit and shaded" rather than two
 * different objects. Used for the toon ramp on every material.
 */
export function shade(hex: number, amount: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Deterministic pick from a list — same seed, same choice, every render. */
export function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(Math.floor(seed)) % list.length];
}

export const SKIN_TONES = [
  PALETTE.skin1, PALETTE.skin2, PALETTE.skin3,
  PALETTE.skin4, PALETTE.skin5, PALETTE.skin6,
] as const;

export const HAIR_COLOURS = [
  PALETTE.hairBrown, PALETTE.hairBlack, PALETTE.hairBlonde,
  PALETTE.hairRed, PALETTE.hairGrey,
] as const;

export const SHIRT_COLOURS = [
  PALETTE.petalPink, PALETTE.skyDeep, PALETTE.leaf, PALETTE.honey,
  PALETTE.petalPurple, PALETTE.orange, PALETTE.mint, PALETTE.strawberry,
] as const;
