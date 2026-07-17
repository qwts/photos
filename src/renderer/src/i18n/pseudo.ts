// Pseudo-locale generation (#403, ADR-0020 §6). Derived at runtime from the `en`
// catalog — dev, Storybook, and CI only, never shipped. `en-XA` accents and
// pads every letter to reveal unextracted strings and English-length
// assumptions; `en-XB` is the bidi pseudo, force-RTL via directionOf() with its
// text bracketed so extracted strings stand out under mirroring.
//
// ICU placeholders (`{count}`, `{name}`) and rich-text tags (`<b>…</b>`) must
// pass through untouched or intl-messageformat fails to parse — the transform
// only rewrites literal characters outside braces and angle brackets.

const ACCENT_MAP: Readonly<Record<string, string>> = {
  a: ' á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: ' q',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: ' x',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Q',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'X',
  Y: 'Ý',
  Z: 'Ž',
};

/** Right-to-left mark — brackets `en-XB` output so bidi runs are visible. */
const RLM = '‏';

type PseudoVariant = 'en-XA' | 'en-XB';

export function isPseudoLocale(locale: string): locale is PseudoVariant {
  return locale === 'en-XA' || locale === 'en-XB';
}

/** Accent literal characters, stepping over ICU `{…}` and markup `<…>` spans. */
function accentOutsideSyntax(message: string): string {
  let out = '';
  let braceDepth = 0;
  let inTag = false;
  for (const char of message) {
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (braceDepth === 0 && char === '<') inTag = true;
    else if (braceDepth === 0 && char === '>') inTag = false;

    if (braceDepth > 0 || inTag) {
      out += char;
      continue;
    }
    out += ACCENT_MAP[char] ?? char;
  }
  return out;
}

function transform(message: string, variant: PseudoVariant): string {
  const accented = accentOutsideSyntax(message);
  if (variant === 'en-XB') return `${RLM}⟪${accented}⟫${RLM}`;
  // en-XA pads to surface English-length assumptions and truncation.
  return `⟦${accented} ⟧`;
}

/** Build a pseudo catalog by transforming every message of the `en` source. */
export function toPseudoCatalog(source: Readonly<Record<string, string>>, variant: PseudoVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, message] of Object.entries(source)) {
    out[id] = transform(message, variant);
  }
  return out;
}
