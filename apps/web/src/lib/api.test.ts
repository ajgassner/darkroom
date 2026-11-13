import { describe, expect, it, vi } from 'vitest';
import { streamEvents } from './api';
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
