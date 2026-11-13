import fs from 'node:fs/promises';
import path from 'node:path';
import { ENV_FILE, OUT_DIR } from '@darkroom/core/config';
import { fakeOpenRouter, testImage } from '@darkroom/core/test/fake-openrouter';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

const app = await buildApp();
beforeAll(() => app.ready());
afterAll(() => app.close());

const HOST = { host: '127.0.0.1:5177' };

function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url, headers: { ...HOST, ...headers } });
}

function post(url: string, body: unknown, method: 'POST' | 'PUT' = 'POST') {
  return app.inject({ method, url, payload: body as object, headers: HOST });
}

function ndjson(body: string) {
  return body
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

describe('local-only protection', () => {
  it('rejects foreign hosts (DNS rebinding) and foreign origins (CSRF)', async () => {
    expect((await get('/api/status', { host: 'evil.example' })).statusCode).toBe(403);
    expect((await get('/api/status', { origin: 'https://evil.example' })).json()).toMatchObject({
      code: 'origin_not_allowed',
    });
  });

  it('accepts the Vite dev server origin', async () => {
    expect((await get('/api/status', { origin: 'http://localhost:5173' })).statusCode).toBe(200);
  });

  it('requires JSON for requests with a body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/delete',
      payload: 'ids=1',
      headers: { ...HOST, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(415);
  });

  it('answers unknown routes with JSON', async () => {
    const res = await get('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found', code: 'not_found' });
  });
});

describe('API', () => {
  it('reports the status', async () => {
    const res = await get('/api/status');
    expect(res.json()).toMatchObject({ hasKey: true, defaultPrivacy: 'zdr', costs: { total: 0, images: 0 } });
  });

  it('stores an API key entered in the UI', async () => {
    fakeOpenRouter();
    const before = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      expect((await get('/api/status')).json()).toMatchObject({ hasKey: false });
      expect((await post('/api/key', { key: 'sk-or-v1-abc' })).json()).toEqual({ ok: true });
      expect((await get('/api/status')).json()).toMatchObject({ hasKey: true });
    } finally {
      process.env.OPENROUTER_API_KEY = before;
      await fs.rm(ENV_FILE, { force: true });
    }
  });

  it('validates request bodies', async () => {
    const res = await post('/api/generate', { prompt: 'p', models: 'not-an-array' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'bad_request' });
  });

  it('manages elements and serves thumbnails', async () => {
    expect((await post('/api/elements', { name: '../x' })).json()).toMatchObject({ code: 'invalid_name' });
    expect((await post('/api/elements', { name: 'acme', type: 'logo' })).json()).toMatchObject({
      name: 'acme',
      type: 'logo',
      instructions: '',
    });
    const updated = await post('/api/elements/acme', { label: 'ACME Inc.' }, 'PUT');
    expect(updated.json()).toMatchObject({ label: 'ACME Inc.', type: 'logo' });
    expect((await get('/api/elements/missing')).statusCode).toBe(404);

    const dataUrl = `data:image/png;base64,${(await testImage({ alpha: true, width: 400, height: 200 })).toString('base64')}`;
    const { file } = (await post('/api/elements/acme/photos', { dataUrl, filename: 'logo.png' })).json();
    const thumb = await get(`/api/elements/acme/photos/${file}?size=100`);
    expect(thumb.headers['content-type']).toBe('image/png');
    expect((await sharp(thumb.rawPayload).metadata()).width).toBeLessThanOrEqual(100);

    const broken = await post('/api/elements/acme/photos', { dataUrl: 'data:image/png;base64,AAAA' });
    expect(broken.json()).toMatchObject({ code: 'image_unreadable' });
  });

  it('serves voice samples to the player, with range requests', async () => {
    await post('/api/voices', { name: 'me', label: 'Me' });
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
    const dataUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
    const { file } = (await post('/api/voices/me/samples', { dataUrl, filename: 'sample.wav' })).json();
    const full = await get(`/api/voices/me/samples/${file}`);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.subarray(0, 4).toString()).toBe('RIFF');
    const ranged = await get(`/api/voices/me/samples/${file}`, { range: 'bytes=0-3' });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers['content-range']).toBe(`bytes 0-3/${wav.length}`);
  });

  it('streams a generation as NDJSON, serves the result and deletes it', async () => {
    fakeOpenRouter();
    const res = await post('/api/generate', { prompt: 'a red square', models: ['test/zdr'], aspectRatio: '' });
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const events = ndjson(res.body);
    expect(events.map((e) => e.type)).toEqual(['start', 'image', 'done']);
    const { entry } = events[1];
    expect(entry).toMatchObject({ ok: true, cost: 0.04, params: { count: 1 } });

    const file = await get(`/out/${entry.file}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['cache-control']).toContain('immutable');
    const ranged = await get(`/out/${entry.file}`, { range: 'bytes=0-9' });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.rawPayload).toHaveLength(10);

    const history = (await get('/api/history')).json();
    expect(history[0].id).toBe(entry.id);
    expect((await get(`/api/debug/${entry.debugId}`)).json()).toMatchObject({ status: 200 });

    expect((await post('/api/delete', {})).json()).toMatchObject({ code: 'nothing_to_delete' });
    expect((await post('/api/delete', { ids: [entry.id] })).json()).toEqual({ entries: 1, files: [entry.file] });
    expect((await get('/api/history')).json()).toEqual([]);
    expect((await get(`/out/${entry.file}`)).statusCode).toBe(404);
    // Costs of deleted results still count
    expect((await get('/api/status')).json().costs).toMatchObject({ total: 0.04, images: 1 });
  });

  it('reports run errors inside the stream', async () => {
    const events = ndjson((await post('/api/generate', { prompt: ' ', models: ['test/zdr'] })).body);
    expect(events).toEqual([{ type: 'fatal', error: 'Prompt is missing', code: 'prompt_missing' }]);
  });
});

describe('files below out/', () => {
  it('never serves the manifest, debug records or paths outside out/', async () => {
    await fs.mkdir(path.join(OUT_DIR, 'debug'), { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, 'debug', 'x.json'), '{}');
    await fs.writeFile(path.join(OUT_DIR, 'manifest.jsonl'), '{}\n');
    expect((await get('/out/manifest.jsonl')).statusCode).toBe(404);
    expect((await get('/out/debug/x.json')).statusCode).toBe(404);
    expect((await get('/out/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(403);
  });

  it('downloads without metadata on request', async () => {
    const jpeg = await sharp(await testImage({ format: 'jpeg' }))
      .withExif({ IFD0: { Copyright: 'secret-owner' } })
      .jpeg()
      .toBuffer();
    await fs.writeFile(path.join(OUT_DIR, 'meta.jpg'), jpeg);

    const raw = await get('/out/meta.jpg?download=1');
    expect(raw.headers['content-disposition']).toBe('attachment; filename="meta.jpg"');
    expect(raw.rawPayload.includes('secret-owner')).toBe(true);
    const clean = await get('/out/meta.jpg?download=1&clean=1');
    expect(clean.rawPayload.includes('secret-owner')).toBe(false);
  });

  it('shows a hint while the UI is not built', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('UI not built yet');
  });
});
