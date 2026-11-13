import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ENV_FILE, OUT_DIR, REFS_DIR, VOICES_DIR } from '@darkroom/core/config';
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

function del(url: string) {
  return app.inject({ method: 'DELETE', url, headers: HOST });
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

  it('deletes elements with their folder', async () => {
    await post('/api/elements', { name: 'gone', label: 'Gone' });
    const dataUrl = `data:image/png;base64,${(await testImage()).toString('base64')}`;
    await post('/api/elements/gone/photos', { dataUrl, filename: 'a.png' });
    expect((await del('/api/elements/gone')).json()).toEqual({ ok: true });
    await expect(fs.access(path.join(REFS_DIR, 'gone'))).rejects.toThrow();
    expect((await get('/api/elements')).json().map((e: { name: string }) => e.name)).not.toContain('gone');
    const missing = await del('/api/elements/gone');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'element_not_found', params: { name: 'gone' } });
    expect((await del('/api/elements/.hidden')).json()).toMatchObject({ code: 'bad_request' });
    expect((await del('/api/elements/%2E%2E%2Fout')).statusCode).toBe(400);
    // Folders outside refs/ stay untouched
    await fs.access(OUT_DIR);
  });

  it('deletes own voices with their folder', async () => {
    await post('/api/voices', { name: 'bye', label: 'Bye' });
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
    await post('/api/voices/bye/samples', { dataUrl: `data:audio/wav;base64,${wav.toString('base64')}` });
    expect((await del('/api/voices/bye')).json()).toEqual({ ok: true });
    await expect(fs.access(path.join(VOICES_DIR, 'bye'))).rejects.toThrow();
    expect((await get('/api/voices')).json().map((v: { name: string }) => v.name)).not.toContain('bye');
    const missing = await del('/api/voices/bye');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'voice_not_found' });
    expect((await del('/api/voices/.x')).statusCode).toBe(400);
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

  it('keeps the debug record of a call while one of its results remains', async () => {
    fakeOpenRouter();
    const res = await post('/api/generate', { prompt: 'p', models: ['test/safety'], count: 2, privacy: 'off' });
    const [a, b] = ndjson(res.body)
      .filter((e) => e.type === 'image')
      .map((e) => e.entry);
    expect(a.debugId).toBe(b.debugId);
    expect(a.file).not.toBe(b.file);
    await post('/api/delete', { ids: [a.id] });
    expect((await get(`/api/debug/${b.debugId}`)).statusCode).toBe(200);
    expect((await get(`/out/${b.file}`)).statusCode).toBe(200);
    await post('/api/delete', { ids: [b.id] });
    expect((await get(`/api/debug/${b.debugId}`)).statusCode).toBe(404);
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
    await fs.writeFile(path.join(OUT_DIR, 'manifest.jsonl.123-abc.tmp'), '{}\n');
    expect((await get('/out/manifest.jsonl')).statusCode).toBe(404);
    expect((await get('/out/manifest.jsonl.123-abc.tmp')).statusCode).toBe(404);
    await fs.rm(path.join(OUT_DIR, 'manifest.jsonl.123-abc.tmp'));
    expect((await get('/out/debug/x.json')).statusCode).toBe(404);
    expect((await get('/out/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(403);
  });

  it('cannot be tricked into serving them by case, detours, separators or trailing dots', async () => {
    await fs.mkdir(path.join(OUT_DIR, 'debug'), { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, 'debug', 'x.json'), '{}');
    await fs.writeFile(path.join(OUT_DIR, 'manifest.jsonl'), '{}\n');
    for (const url of [
      '/out/MANIFEST.JSONL',
      '/out/Manifest.jsonl',
      '/out/./manifest.jsonl',
      '/out/uploads/../manifest.jsonl',
      '/out/uploads%2F..%2Fmanifest.jsonl',
      '/out/manifest.jsonl.',
      '/out/manifest.jsonl.tmp',
      '/out/DEBUG/X.JSON',
      '/out/debug/../debug/x.json',
      '/out/debug%5Cx.json',
      '/out/debug/x.json.',
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
    // Other files below debug/ (sent reference images) stay available
    await fs.mkdir(path.join(OUT_DIR, 'debug', 'refs'), { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, 'debug', 'refs', 'r.png'), await testImage());
    expect((await get('/out/debug/refs/r.png')).statusCode).toBe(200);
  });

  it('serves results with a restrictive content security policy (no scripts in SVGs)', async () => {
    await fs.writeFile(
      path.join(OUT_DIR, 'evil.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    );
    for (const url of ['/out/evil.svg', '/out/evil.svg?download=1']) {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      const csp = String(res.headers['content-security-policy']);
      // default-src 'none' without script-src (or a looser default) blocks the script
      expect(csp).toMatch(/^default-src 'none';/);
      expect(csp).not.toMatch(/script-src|unsafe-eval|default-src [^;]*'self'/);
      expect(csp).toMatch(/; sandbox$/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('serves audio results without sandbox, so they play when opened in a tab', async () => {
    await fs.writeFile(path.join(OUT_DIR, 'song.mp3'), Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]));
    const res = await get('/out/song.mp3');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^audio\/mpeg/);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
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

describe('shutdown', () => {
  /** Fake upstream call that only ends when it is aborted; `called` resolves once it was made. */
  function hangingUpstream() {
    let started = () => {};
    const called = new Promise<void>((r) => {
      started = r;
    });
    const handler = (_body: unknown, init: RequestInit | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        started();
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    return { called, handler };
  }

  /** POST over a real socket (not inject), so a hijacked stream has to end for close() to finish. */
  function postOverSocket(port: number, url: string, body: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { port, method: 'POST', path: url, headers: { ...HOST, 'content-type': 'application/json' } },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve(text));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  it('aborts a running generation and ends its stream when the server closes', async () => {
    const upstream = hangingUpstream();
    const fake = fakeOpenRouter({ images: upstream.handler });
    const server = await buildApp();
    await server.listen({ host: '127.0.0.1', port: 0 });
    const { port } = server.server.address() as AddressInfo;
    const body = postOverSocket(port, '/api/generate', { prompt: 'slow', models: ['test/zdr'] });
    await upstream.called;

    const t0 = performance.now();
    await server.close();
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(fake.imageCalls()[0].signal?.aborted).toBe(true);
    const events = ndjson(await body);
    expect(events.map((e) => e.type)).toEqual(['start', 'error', 'done']);
    expect(events[1].entry).toMatchObject({ ok: false, errorCode: 'aborted' });
  });

  it('aborts a running transcription and saves no transcript', async () => {
    const upstream = hangingUpstream();
    fakeOpenRouter({ transcription: upstream.handler });
    const server = await buildApp();
    const req = (url: string, payload: object) => server.inject({ method: 'POST', url, payload, headers: HOST });
    await req('/api/voices', { name: 'quiet' });
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
    const dataUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
    const { file } = (await req('/api/voices/quiet/samples', { dataUrl, filename: 'a.wav' })).json();

    const pending = req(`/api/voices/quiet/samples/${file}/transcribe`, { engine: 'api' });
    await upstream.called;
    await server.close();
    expect((await pending).statusCode).toBeGreaterThanOrEqual(400);
    const voice = (await get('/api/voices')).json().find((v: { name: string }) => v.name === 'quiet');
    expect(voice.transcripts).toEqual({});
  });

  it('aborts a running voice preview', async () => {
    const upstream = hangingUpstream();
    const fake = fakeOpenRouter({ speech: upstream.handler });
    const server = await buildApp();
    const pending = server.inject({
      method: 'POST',
      url: '/api/speech/demo',
      payload: { model: 'test/tts', voice: 'alloy' },
      headers: HOST,
    });
    await upstream.called;
    await server.close();
    expect(fake.callsTo('/audio/speech')[0].signal?.aborted).toBe(true);
    expect((await pending).json()).toMatchObject({ code: 'aborted' });
  });
});
