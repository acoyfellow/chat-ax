export type AvatarStyle = 'clean' | 'wild';
export type AvatarHeadShape = 'rounded' | 'dome' | 'boxy' | 'trapezoid' | 'wide' | 'blob' | 'shard';
export type AvatarEyes = 'dots' | 'rings' | 'visor' | 'wink' | 'sleepy' | 'mismatched' | 'cyclops' | 'cluster';
export type AvatarMouth = 'smile' | 'grin' | 'flat' | 'open' | 'zigzag' | 'frown' | 'none';
export type AvatarAntenna = 'single' | 'double' | 'offset' | 'loop' | 'array' | 'none';
export type AvatarEars = 'round' | 'square' | 'bars' | 'mismatched' | 'none';
export type AvatarDetail = 'none' | 'bolts' | 'cheeks' | 'seam' | 'lights' | 'stamp';
export type AvatarPalette = 'soft' | 'neon' | 'ink' | 'clash' | 'mono';
export type AvatarTexture = 'flat' | 'hatch' | 'dots' | 'split';
export type AvatarJoins = 'round' | 'square';
export type AvatarMotion = 'none' | 'blink' | 'float' | 'bob' | 'wobble' | 'glance' | 'bounce';
export type AvatarMood = 'idle' | 'thinking' | 'speaking';

export type AvatarOptions = {
  style: AvatarStyle;
  palette: AvatarPalette;
  stroke: string;
  fill: string;
  background: string;
  accent: string;
  headShape: AvatarHeadShape;
  headWidth: number;
  headHeight: number;
  scale: number;
  tilt: number;
  wobble: number;
  texture: AvatarTexture;
  aberration: number;
  eyes: AvatarEyes;
  eyeSize: number;
  eyeSpacing: number;
  eyeY: number;
  mouth: AvatarMouth;
  mouthWidth: number;
  mouthY: number;
  antenna: AvatarAntenna;
  antennaHeight: number;
  ears: AvatarEars;
  earSize: number;
  detail: AvatarDetail;
  stamp: string;
  lineWidth: number;
  joins: AvatarJoins;
  motion: AvatarMotion;
};

export const avatarStyles: AvatarStyle[] = ['clean', 'wild'];
export const avatarPalettes: AvatarPalette[] = ['soft', 'neon', 'ink', 'clash', 'mono'];
export const avatarHeadShapes: AvatarHeadShape[] = ['rounded', 'dome', 'boxy', 'trapezoid', 'wide', 'blob', 'shard'];
export const avatarEyeStyles: AvatarEyes[] = ['dots', 'rings', 'visor', 'wink', 'sleepy', 'mismatched', 'cyclops', 'cluster'];
export const avatarMouthStyles: AvatarMouth[] = ['smile', 'grin', 'flat', 'open', 'zigzag', 'frown', 'none'];
export const avatarAntennaStyles: AvatarAntenna[] = ['single', 'double', 'offset', 'loop', 'array', 'none'];
export const avatarEarStyles: AvatarEars[] = ['round', 'square', 'bars', 'mismatched', 'none'];
export const avatarDetailStyles: AvatarDetail[] = ['none', 'bolts', 'cheeks', 'seam', 'lights', 'stamp'];
export const avatarTextures: AvatarTexture[] = ['flat', 'hatch', 'dots', 'split'];
export const avatarMotions: AvatarMotion[] = ['none', 'blink', 'float', 'bob', 'wobble', 'glance', 'bounce'];
export const avatarMoods: AvatarMood[] = ['idle', 'thinking', 'speaking'];

const hues = [4, 22, 38, 150, 172, 200, 226, 262, 286, 330];
const stamps = ['UNIT 7', 'v0.3', 'BETA', 'NO.42', 'AX', 'HELLO', '0x1F', 'RUN'];

export function stringToHash(value: string): number {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result += (result << 1) + (result << 4) + (result << 7) + (result << 8) + (result << 24);
  }
  return Math.abs(result >>> 0);
}

export function roll(seed: number, slot: number, span: number): number {
  let value = (seed ^ Math.imul(slot, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) % span;
}

function pick<T>(seed: number, slot: number, list: T[]): T {
  return list[roll(seed, slot, list.length)];
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function paletteColors(palette: AvatarPalette, seed: number) {
  const hue = hues[roll(seed, 1, hues.length)];
  const complement = (hue + 150 + roll(seed, 2, 60)) % 360;
  if (palette === 'neon') {
    return { stroke: hslToHex(hue, 100, 62), fill: hslToHex(complement, 100, 60), background: '#0b0b0f', accent: hslToHex((hue + 60) % 360, 100, 65) };
  }
  if (palette === 'ink') {
    return { stroke: '#161616', fill: hslToHex(hue, 85, 55), background: '#f4efe6', accent: hslToHex(complement, 85, 50) };
  }
  if (palette === 'clash') {
    return { stroke: hslToHex(hue, 90, 40), fill: hslToHex((hue + 180) % 360, 95, 55), background: hslToHex((hue + 90) % 360, 90, 70), accent: hslToHex((hue + 270) % 360, 95, 55) };
  }
  if (palette === 'mono') {
    const light = roll(seed, 3, 2) === 0;
    return { stroke: light ? '#111111' : '#f5f5f5', fill: light ? '#111111' : '#f5f5f5', background: light ? '#ffffff' : '#111111', accent: hslToHex(hue, 95, 55) };
  }
  return {
    stroke: hslToHex(hue, 70, 38 + roll(seed, 3, 10)),
    fill: hslToHex(hue, 78, 52 + roll(seed, 4, 10)),
    background: hslToHex(hue, 60, 94 + roll(seed, 5, 3)),
    accent: hslToHex(complement, 80, 55),
  };
}

export function generateAvatarOptions(hash: string, style: AvatarStyle = 'wild'): AvatarOptions {
  const seed = stringToHash(hash);
  const wild = style === 'wild';
  const palette: AvatarPalette = wild ? pick(seed, 30, avatarPalettes) : 'soft';
  const colors = paletteColors(palette, seed);
  const headShape = wild ? pick(seed, 6, avatarHeadShapes) : pick(seed, 6, avatarHeadShapes.slice(0, 5));
  const eyes = wild ? pick(seed, 10, avatarEyeStyles) : pick(seed, 10, avatarEyeStyles.slice(0, 6));
  return {
    style,
    palette,
    ...colors,
    headShape,
    headWidth: 52 + roll(seed, 7, 28),
    headHeight: 42 + roll(seed, 8, 22),
    scale: wild ? 1 + roll(seed, 31, 6) / 10 : 1,
    tilt: wild ? roll(seed, 9, 41) - 20 : roll(seed, 9, 13) - 6,
    wobble: wild ? roll(seed, 32, 4) : 0,
    texture: wild ? pick(seed, 33, avatarTextures) : 'flat',
    aberration: wild && roll(seed, 34, 3) === 0 ? 2 + roll(seed, 35, 3) : 0,
    eyes,
    eyeSize: 3 + roll(seed, 11, 6),
    eyeSpacing: 22 + roll(seed, 12, 22),
    eyeY: 58 + roll(seed, 13, 10),
    mouth: wild ? pick(seed, 14, avatarMouthStyles) : pick(seed, 14, avatarMouthStyles.slice(0, 6)),
    mouthWidth: 16 + roll(seed, 15, 18),
    mouthY: 76 + roll(seed, 16, 8),
    antenna: wild ? pick(seed, 17, avatarAntennaStyles) : pick(seed, 17, avatarAntennaStyles.filter((item) => item !== 'array')),
    antennaHeight: 12 + roll(seed, 18, 20),
    ears: pick(seed, 19, avatarEarStyles),
    earSize: 5 + roll(seed, 20, 7),
    detail: wild ? pick(seed, 21, avatarDetailStyles) : pick(seed, 21, avatarDetailStyles.slice(0, 5)),
    stamp: pick(seed, 36, stamps),
    lineWidth: 4 + roll(seed, 22, 5),
    joins: roll(seed, 23, 3) === 0 ? 'square' : 'round',
    motion: pick(seed, 37, avatarMotions.slice(1)),
  };
}
