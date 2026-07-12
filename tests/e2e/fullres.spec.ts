import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, _electron as electron } from '@playwright/test';

// #91 exit criteria: full-res originals decrypt to the lightbox memory-only
// over overlook-full:// — rapid next/prev paging stays responsive under a
// bounded buffer budget, RAW records serve preview-marked responses, and no
// plaintext ever lands on disk (including Chromium's HTTP disk cache, which
// `Cache-Control: no-store` must keep out of the loop).

/** Every file under `dir` containing `marker` as raw bytes. */
function filesContaining(dir: string, marker: Buffer): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) {
        continue;
      }
      if (readFileSync(path).includes(marker)) {
        hits.push(name);
      }
    } catch {
      continue; // transient profile files may vanish mid-walk
    }
  }
  return hits;
}

test('full-res delivery: memory-only, preview-marked RAW, bounded rapid paging', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'overlook-e2e-fullres-'));
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OVERLOOK_USER_DATA: userData,
      OVERLOOK_SEED: '12',
      OVERLOOK_INSECURE_KEYSTORE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('virtual-grid').waitFor();

    // A JPEG record serves its original: correct mime, no-store, no marker.
    const jpegResponse = await page.evaluate<{
      status: number;
      contentType: string | null;
      cacheControl: string | null;
      preview: string | null;
      soi: boolean;
    }>(`fetch('overlook-full://library/01J8SEEDPHOTO0001').then(async (res) => {
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        cacheControl: res.headers.get('cache-control'),
        preview: res.headers.get('x-overlook-preview'),
        soi: bytes[0] === 0xff && bytes[1] === 0xd8,
      };
    })`);
    expect(jpegResponse).toEqual({
      status: 200,
      contentType: 'image/jpeg',
      cacheControl: 'no-store',
      preview: null,
      soi: true,
    });

    // Seed photo 0000 is a RAW record (every 5th) — ADR-0006: the response
    // is its viewable preview, marked so the lightbox can badge PREVIEW.
    const rawPreview = await page.evaluate<string | null>(
      `fetch('overlook-full://library/01J8SEEDPHOTO0000').then((res) => res.headers.get('x-overlook-preview'))`,
    );
    expect(rawPreview).toBe('1');

    // Missing photos 404 (the lightbox placeholder contract).
    const missing = await page.evaluate<number>(`fetch('overlook-full://library/01J8DOESNOTEXIST').then((res) => res.status)`);
    expect(missing).toBe(404);

    // Neighbor prefetch answers immediately with no body.
    const prefetch = await page.evaluate<{ status: number; size: number }>(
      `fetch('overlook-full://library/01J8SEEDPHOTO0002?prefetch=1').then(async (res) => ({ status: res.status, size: (await res.arrayBuffer()).byteLength }))`,
    );
    expect(prefetch).toEqual({ status: 204, size: 0 });

    // EXIT CRITERIA: 20 rapid next/prev steps — each hop aborts the previous
    // in-flight request (the FullService drops queued work for frames the
    // user already left) and the final frame still resolves fully.
    const paging = await page.evaluate<{ ok: boolean; settled: number }>(`(async () => {
      const ids = [];
      for (let step = 0; step < 20; step += 1) {
        const index = step < 10 ? step + 1 : 20 - step; // next x10, prev x10
        ids.push('01J8SEEDPHOTO' + String(index).padStart(4, '0'));
      }
      let previous = null;
      let settled = 0;
      let last = null;
      for (const id of ids) {
        if (previous) previous.abort();
        previous = new AbortController();
        last = fetch('overlook-full://library/' + id, { signal: previous.signal })
          .then((res) => { settled += 1; return res.ok; })
          .catch(() => null);
      }
      const ok = await last;
      return { ok: ok === true, settled };
    })()`);
    expect(paging.ok).toBe(true);
    expect(paging.settled).toBeGreaterThan(0);

    // EXIT CRITERIA: no plaintext on disk under any path. Every seed blob
    // carries a unique ASCII marker; after full-res fetches and thumb loads
    // the ONLY files allowed to contain it are none — blobs and DB are
    // encrypted, and no-store keeps the HTTP disk cache out of the loop.
    const leaks = filesContaining(userData, Buffer.from('overlook-seed-', 'ascii'));
    expect(leaks).toEqual([]);
  } finally {
    await app.close();
  }
});
