import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lightboxCss = readFileSync('src/renderer/src/lightbox/lightbox.css', 'utf8');

test('lightbox toolbar reserves blank space for native window dragging (#577)', () => {
  assert.match(lightboxCss, /\.ovl-lightbox__top\s*\{[^}]*-webkit-app-region:\s*drag;/su);
  assert.match(lightboxCss, /\.ovl-lightbox__top\s*>\s*button\s*\{[^}]*-webkit-app-region:\s*no-drag;/su);
  assert.doesNotMatch(lightboxCss, /\.ovl-lightbox__top\.ovl-lightbox__chrome--on\s*\{[^}]*-webkit-app-region:\s*no-drag;/su);
});
