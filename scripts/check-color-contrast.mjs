#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { contrastRatio, oklchToSrgb, srgb } from '../src/shared/theme/contrast.ts';

const COLOR_TOKENS = 'src/renderer/src/styles/tokens/colors.css';
const PAIRS = [
  ...['--text-body', '--text-muted', '--text-faint'].flatMap((foreground) =>
    ['--surface-window', '--surface-panel', '--surface-card', '--surface-raised'].map((background) => ({
      foreground,
      background,
      minimum: 4.5,
    })),
  ),
  ...['--accent-iris', '--accent-cyan-bright', '--accent-violet', '--accent-amber', '--accent-green', '--accent-red'].map((background) => ({
    foreground: '--text-on-accent',
    background,
    minimum: 4.5,
  })),
  ...['--accent-iris', '--accent-amber', '--accent-green', '--accent-red'].flatMap((foreground) =>
    ['--surface-window', '--surface-panel', '--surface-card', '--surface-raised'].map((background) => ({
      foreground,
      background,
      minimum: 3,
    })),
  ),
];

function declarations(body) {
  return new Map([...body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gimu)].map((match) => [match[1], match[2].trim()]));
}

function themes(source) {
  const base = new Map();
  const overrides = new Map();
  for (const match of source.matchAll(/:root(?:\[data-theme=['"]([^'"]+)['"]\])?\s*\{([^}]+)\}/gimu)) {
    const name = match[1] ?? 'dark';
    const values = declarations(match[2]);
    if (name === 'dark') for (const [token, value] of values) base.set(token, value);
    else overrides.set(name, values);
  }
  return new Map([['dark', base], ...[...overrides].map(([name, values]) => [name, new Map([...base, ...values])])]);
}

function resolveToken(values, token, seen = new Set()) {
  if (seen.has(token)) throw new Error(`Token cycle while resolving ${token}`);
  const value = values.get(token);
  if (value === undefined) throw new Error(`Missing declared color token ${token}`);
  const alias = /^var\((--[a-z0-9-]+)\)$/iu.exec(value);
  if (alias === null) return value;
  return resolveToken(values, alias[1], new Set([...seen, token]));
}

function parseColor(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value);
  if (hex !== null) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map((digit) => `${digit}${digit}`).join('') : hex[1];
    return srgb(
      Number.parseInt(expanded.slice(0, 2), 16) / 255,
      Number.parseInt(expanded.slice(2, 4), 16) / 255,
      Number.parseInt(expanded.slice(4, 6), 16) / 255,
    );
  }
  const rgb = /^rgb\(\s*([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)%?\s*\)$/iu.exec(value);
  if (rgb !== null) {
    const percent = value.includes('%');
    const scale = percent ? 100 : 255;
    return srgb(Number(rgb[1]) / scale, Number(rgb[2]) / scale, Number(rgb[3]) / scale);
  }
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/iu.exec(value);
  if (oklch !== null) return oklchToSrgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  throw new Error(`Unsupported solid color syntax: ${value}`);
}

const source = await readFile(path.resolve(process.cwd(), COLOR_TOKENS), 'utf8');
const failures = [];
let checks = 0;
for (const [theme, values] of themes(source)) {
  for (const pair of PAIRS) {
    const foreground = parseColor(resolveToken(values, pair.foreground));
    const background = parseColor(resolveToken(values, pair.background));
    const ratio = contrastRatio(foreground, background);
    checks += 1;
    if (ratio + Number.EPSILON < pair.minimum) {
      failures.push(`${theme}: ${pair.foreground} on ${pair.background} = ${ratio.toFixed(2)}:1; needs ${pair.minimum.toFixed(1)}:1`);
    }
  }
}

if (failures.length > 0) {
  console.error('Declared color contrast check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Declared color contrast check OK: ${String(checks)} semantic pairs across ${String(themes(source).size)} theme(s).`);
}
