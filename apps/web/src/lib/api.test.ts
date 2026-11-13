import { describe, expect, it, vi } from 'vitest';
import { api, canBeTransparent, errorToastId, refThumbUrl, streamEvents } from './api';
import type { RunEvent } from './types';

function stream(chunks: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

describe('server not reachable', () => {
  const failedFetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  it('throws a coded error instead of "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', failedFetch);
    await expect(api('/api/status')).rejects.toMatchObject({ code: 'server_unreachable' });
    await expect(streamEvents('/api/generate', {}, () => {}, new AbortController().signal)).rejects.toMatchObject({
      code: 'server_unreachable',
      message: expect.stringContaining('darkroom start'),
    });
  });

  it('gives all "not reachable" errors the same toast id', async () => {
    vi.stubGlobal('fetch', failedFetch);
    const errors = await Promise.all([api('/api/status').catch((e) => e), api('/api/history').catch((e) => e)]);
    expect(errors.map(errorToastId)).toEqual(['server_unreachable', 'server_unreachable']);
    expect(errorToastId(new Error('boom'))).toBeUndefined();
    expect(errorToastId(null)).toBeUndefined();
  });

  it('reports a stream that breaks off as unreachable', async () => {
    const broken = new ReadableStream({
      pull(c) {
        c.error(new TypeError('network error'));
      },
    });
    vi.stubGlobal('fetch', async () => new Response(broken));
    await expect(streamEvents('/api/generate', {}, () => {}, new AbortController().signal)).rejects.toMatchObject({
      code: 'server_unreachable',
    });
  });

  it('keeps cancelling distinguishable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(streamEvents('/api/generate', {}, () => {}, new AbortController().signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('canBeTransparent', () => {
  it('is true for formats with an alpha channel', () => {
    expect(canBeTransparent('run/a.PNG')).toBe(true);
    expect(canBeTransparent('a.webp')).toBe(true);
    expect(canBeTransparent('a.jpg')).toBe(false);
    expect(canBeTransparent('a.png.jpeg')).toBe(false);
  });
});

describe('refThumbUrl', () => {
  it('uses the thumbnail route for uploads and the file itself for results', () => {
    expect(refThumbUrl('uploads/0123456789abcdef.jpg')).toBe('/api/uploads/0123456789abcdef.jpg/thumb?size=96');
    expect(refThumbUrl('uploads/0123456789abcdef.jpg', 200)).toBe('/api/uploads/0123456789abcdef.jpg/thumb?size=200');
    expect(refThumbUrl('2026-01-01/a b.png')).toBe('/out/2026-01-01/a%20b.png');
  });
});

describe('api', () => {
  it('returns the JSON body and throws server errors with their code', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ ok: true }));
    expect(await api('/api/x', { body: { a: 1 } })).toEqual({ ok: true });
    vi.stubGlobal('fetch', async () => Response.json({ error: 'gone', code: 'not_found' }, { status: 404 }));
    await expect(api('/api/x')).rejects.toMatchObject({ message: 'gone', code: 'not_found' });
  });
});

describe('streamEvents', () => {
  it('reads NDJSON events split across chunks', async () => {
    const start = '{"type":"start","runId":"r","plan":[]}';
    const done = '{"type":"done","runId":"r","images":0,"failed":0,"cost":0}';
    const chunks = [`${start}\n${done.slice(0, 10)}`, `${done.slice(10)}\n\n`];
    vi.stubGlobal('fetch', async () => new Response(stream(chunks)));
    const events: RunEvent[] = [];
    await streamEvents('/api/generate', {}, (e) => events.push(e), new AbortController().signal);
    expect(events.map((e) => e.type)).toEqual(['start', 'done']);
  });

  it('throws the server error message', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Prompt is missing' }, { status: 400 }));
    await expect(streamEvents('/api/generate', {}, () => {}, new AbortController().signal)).rejects.toThrow(
      'Prompt is missing',
    );
  });

  it('throws a fatal event with its code and params', async () => {
    const fatal =
      '{"type":"fatal","error":"Element not found: anna","code":"element_not_found","params":{"name":"anna"}}';
    vi.stubGlobal('fetch', async () => new Response(stream([`{"type":"start","runId":"r","plan":[]}\n${fatal}\n`])));
    const events: RunEvent[] = [];
    const run = streamEvents('/api/generate', {}, (e) => events.push(e), new AbortController().signal);
    await expect(run).rejects.toMatchObject({
      message: 'Element not found: anna',
      code: 'element_not_found',
      params: { name: 'anna' },
    });
    expect(events.map((e) => e.type)).toEqual(['start']);
  });
});
