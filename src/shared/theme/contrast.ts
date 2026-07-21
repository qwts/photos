export type SrgbColor = readonly [red: number, green: number, blue: number];

function channel(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('sRGB channels must be finite values from 0 to 1');
  return value;
}

function linearize(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(value: number): number {
  const bounded = Math.min(1, Math.max(0, value));
  return bounded <= 0.003_130_8 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

export function srgb(red: number, green: number, blue: number): SrgbColor {
  return [channel(red), channel(green), channel(blue)];
}

export function srgb8(red: number, green: number, blue: number): SrgbColor {
  return srgb(red / 255, green / 255, blue / 255);
}

export function relativeLuminance(color: SrgbColor): number {
  const [red, green, blue] = color.map((value) => linearize(channel(value))) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: SrgbColor, second: SrgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convert an in-gamut CSS OKLCH color to encoded sRGB for WCAG luminance. */
export function oklchToSrgb(lightness: number, chroma: number, hueDegrees: number): SrgbColor {
  if (![lightness, chroma, hueDegrees].every(Number.isFinite)) throw new RangeError('OKLCH channels must be finite');
  if (lightness < 0 || lightness > 1 || chroma < 0) throw new RangeError('OKLCH lightness/chroma are out of range');
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lRoot = lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
  const mRoot = lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
  const sRoot = lightness - 0.089_484_177_5 * a - 1.291_485_548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  return srgb(
    encode(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    encode(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    encode(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  );
}
