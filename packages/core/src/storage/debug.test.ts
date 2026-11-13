import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testImage } from '../../test/fake-openrouter.ts';
import { OUT_DIR } from '../config.ts';
import { DEBUG_DIR, deleteDebug, pickHeaders, pruneDebugRefs, readDebug, writeDebug } from './debug.ts';

const base = { endpoint: 'x/images', method: 'POST', status: 200, durationMs: 5, responseHeaders: {} };

/** A PNG data URL; different widths give different images (and sent files). */
const dataUrl = async (width: number) => `data:image/png;base64,${(await testImage({ width })).toString('base64')}`;

/** A record of a call that sent these images. */
const sending = (...urls: string[]) => ({
  ...base,
  request: { input_references: urls.map((url) => ({ image_url: { url } })) },
  response: {},
});

const exists = (rel: string) =>
  fs.stat(path.join(OUT_DIR, rel)).then(
    () => true,
    () => false,
  );

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

    await deleteDebug([id]);
    await expect(readDebug(id)).rejects.toThrow();
    // Its sent file went with it (no other record lists it)
    expect(await fs.readdir(path.join(DEBUG_DIR, 'refs'))).toEqual([]);
  });

  it('keeps a sent file while another record still lists it', async () => {
    const shared = await dataUrl(30);
    const a = await writeDebug(sending(shared, await dataUrl(31)));
    const b = await writeDebug(sending(shared));
    const [sharedFile, ownFile] = (await readDebug(a)).sentFiles.map((f) => f.file);
    expect((await readDebug(b)).sentFiles.map((f) => f.file)).toEqual([sharedFile]);

    await deleteDebug([a]);
    expect(await exists(sharedFile)).toBe(true);
    expect(await exists(ownFile)).toBe(false);
    await deleteDebug([b]);
    expect(await exists(sharedFile)).toBe(false);
  });

  it('removes sent files of both records deleted together', async () => {
    const shared = await dataUrl(40);
    const ids = [await writeDebug(sending(shared)), await writeDebug(sending(shared))];
    const [file] = (await readDebug(ids[0])).sentFiles.map((f) => f.file);
    await deleteDebug(ids);
    expect(await exists(file)).toBe(false);
  });

  it('cleans up sent files no record lists, leaving other files alone', async () => {
    const kept = await writeDebug(sending(await dataUrl(50)));
    const [keptFile] = (await readDebug(kept)).sentFiles.map((f) => f.file);
    const refs = path.join(DEBUG_DIR, 'refs');
    await fs.writeFile(path.join(refs, '0123456789abcdef.png'), 'x');
    await fs.writeFile(path.join(refs, 'notes.txt'), 'x');
    await fs.writeFile(path.join(DEBUG_DIR, 'notes.json'), '{}');
    expect(await pruneDebugRefs()).toEqual(['0123456789abcdef.png']);
    expect(await exists(keptFile)).toBe(true);
    expect(await exists('debug/refs/notes.txt')).toBe(true);
    expect(await pruneDebugRefs()).toEqual([]);
  });

  it('rejects invalid IDs', async () => {
    await expect(readDebug('../manifest')).rejects.toMatchObject({ code: 'invalid_debug_id' });
    await expect(deleteDebug(['../x', ''])).resolves.toBeUndefined();
    // A record that cannot be read is still removed
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const broken = '00000000-0000-0000-0000-000000000000';
    await fs.writeFile(path.join(DEBUG_DIR, `${broken}.json`), 'not json');
    await deleteDebug([broken]);
    await expect(fs.stat(path.join(DEBUG_DIR, `${broken}.json`))).rejects.toThrow();
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
