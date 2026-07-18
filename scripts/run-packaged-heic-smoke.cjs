'use strict';

const { readFileSync, writeSync } = require('node:fs');

const bindingPath = process.argv[2];
const fixturePath = process.argv[3];
if (bindingPath === undefined || fixturePath === undefined) {
  throw new Error('packaged HEIC smoke requires a native binding and fixture path');
}

const { decodeHeic } = require(bindingPath);
let original;
let preview;

void (async () => {
  try {
    original = readFileSync(fixturePath);
    const result = await decodeHeic(original, 4096);
    preview = result.bytes;
    if (!Buffer.isBuffer(preview) || preview.length < 3 || !preview.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      throw new Error('packaged HEIC decoder returned a non-JPEG payload');
    }
    writeSync(process.stdout.fd, `overlook-heic-smoke:ready:${String(result.width)}x${String(result.height)}\n`);
  } finally {
    original?.fill(0);
    preview?.fill(0);
  }
})().catch((error) => {
  writeSync(process.stderr.fd, `overlook-heic-smoke:error:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
