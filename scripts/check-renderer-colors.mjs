#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const COLOR_LITERAL = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:color|hsl|hsla|lab|lch|oklch|rgb|rgba)\s*\(/giu;

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));
}

export function findRendererColorLiterals(files) {
  const violations = [];
  for (const { file, source } of files) {
    if (!file.endsWith('.css') || file.includes('/styles/tokens/')) continue;
    const searchable = withoutComments(source);
    for (const match of searchable.matchAll(COLOR_LITERAL)) {
      const index = match.index ?? 0;
      const line = searchable.slice(0, index).split('\n').length;
      violations.push({ file, line, literal: match[0] });
    }
  }
  return violations;
}

async function cssFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await cssFiles(entryPath, root)));
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push({ file: path.relative(root, entryPath).replaceAll(path.sep, '/'), source: await readFile(entryPath, 'utf8') });
    }
  }
  return files;
}

async function main() {
  const rendererRoot = path.join(process.cwd(), 'src/renderer');
  const violations = findRendererColorLiterals(await cssFiles(rendererRoot));
  if (violations.length === 0) {
    console.log('Renderer color-token gate OK.');
    return;
  }
  console.error('Renderer CSS color literals must live under src/renderer/src/styles/tokens/:');
  for (const violation of violations) console.error(`- src/renderer/${violation.file}:${violation.line}: ${violation.literal}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
