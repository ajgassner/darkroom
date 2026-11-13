import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testImage } from '../../test/fake-openrouter.ts';
import { OUT_DIR } from '../config.ts';
import { DEBUG_DIR, deleteDebug, pickHeaders, readDebug, writeDebug } from './debug.ts';

const base = { endpoint: 'x/images', method: 'POST', status: 200, durationMs: 5, responseHeaders: {} };

describe('debug records', () => {
  it('replaces sent images by numbered placeholders and stores them once', async () => {
    const png = (await testImage({ width: 30, height: 20 })).toString('base64');
    const id = await writeDebug({
      ...base,
      request: {
        prompt: 'p',
        input_references: [
          { image_url: { url: `data:image/png;base64,${png}` } },
          { image_url: { url: `data:image/png;base64,${png}` } },
          { input_audio: { data: 'A'.repeat(3000), format: 'wav' } },
        ],
      },
      response: { data: [{ b64_json: 'B'.repeat(3000) }], note: 'short text' },
    });
    const rec = await readDebug(id);
    const refs = (rec.request as { input_references: Record<string, Record<string, string>>[] }).input_references;
    expect(refs[0].image_url.url).toMatch(/^<image\/png 0 KB 30×20 → reference #1>$/);
    expect(refs[1].image_url.url).toMatch(/→ reference #2>$/);
    expect(refs[2].input_audio.data).toBe('<base64 3 KB omitted>');
    expect(rec.response).toEqual({ data: [{ b64_json: '<base64 3 KB omitted>' }], note: 'short text' });
    expect(rec.sentFiles).toEqual([
      expect.objectContaining({ index: 1, mime: 'image/png', width: 30, height: 20 }),
      expect.objectContaining({ index: 2, file: rec.sentFiles[0].file }),
    ]);
    expect(await fs.readdir(path.join(DEBUG_DIR, 'refs'))).toHaveLength(1);
    await expect(fs.stat(path.join(OUT_DIR, rec.sentFiles[0].file))).resolves.toBeTruthy();

    await deleteDebug(id);
    await expect(readDebug(id)).rejects.toThrow();
  });

  it('rejects invalid IDs', async () => {
    await expect(readDebug('../manifest')).rejects.toMatchObject({ code: 'invalid_debug_id' });
    await expect(deleteDebug('../x')).resolves.toBeUndefined();
  });

  it('keeps only useful response headers', () => {
    const h = new Headers({
      'content-type': 'application/json',
      'x-generation-id': 'g',
      'x-ratelimit-remaining': '9',
      'set-cookie': 'secret',
    });
    expect(pickHeaders(h)).toEqual({
      'content-type': 'application/json',
      'x-generation-id': 'g',
      'x-ratelimit-remaining': '9',
    });
    expect(pickHeaders(null)).toEqual({});
  });
});
