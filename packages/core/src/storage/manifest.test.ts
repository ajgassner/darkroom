import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { MANIFEST, OUT_DIR } from '../config.ts';
import type { ManifestEntry } from '../contract.ts';
import {
  appendEntry,
  costSummary,
  markDeleted,
  readEntries,
  removeFiles,
  unusedDebugIds,
  unusedUploads,
  updateEntry,
} from './manifest.ts';

const LOCK = `${MANIFEST}.lock`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function entry(over: Partial<ManifestEntry>): ManifestEntry {
  return {
    id: 'id',
    runId: 'run',
    ts: '2026-11-12T00:00:00.000Z',
    ok: true,
    file: null,
    prompt: 'p',
    fullPrompt: 'p',
    model: 'test/zdr',
    element: null,
    usePrefix: true,
    extraRefs: [],
    refCount: 0,
    params: {},
    privacy: 'zdr',
    providerRestriction: null,
    warnings: [],
    generationId: null,
    provider: null,
    cost: null,
    callCost: null,
    durationMs: 0,
    mediaType: null,
    ...over,
  };
}

describe('manifest', () => {
  it('is empty without a file', async () => {
    expect(await readEntries()).toEqual([]);
    expect(await markDeleted(() => true)).toEqual([]);
    expect(await updateEntry('x', {})).toBe(false);
  });

  it('appends concurrently, skips broken lines, updates and marks entries', async () => {
    await Promise.all([
      appendEntry(entry({ id: 'a', model: 'm1', cost: 0.04, file: 'a.png' })),
      appendEntry(entry({ id: 'b', model: 'm1', cost: 0.02, runId: 'r2' })),
      appendEntry(entry({ id: 'c', model: 'm2', ok: false, cost: null })),
    ]);
    await fs.appendFile(MANIFEST, '{broken json\n');
    expect((await readEntries()).map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);

    expect(await updateEntry('b', { cost: 0.03 })).toBe(true);
    const marked = await markDeleted((e) => e.runId === 'r2');
    expect(marked.map((e) => e.id)).toEqual(['b']);
    expect(await markDeleted((e) => e.runId === 'r2')).toEqual([]); // only once

    const all = await readEntries();
    const b = all.find((e) => e.id === 'b');
    expect(b).toMatchObject({ cost: 0.03, deleted: expect.any(String) });
    // Deleted results still count towards the costs, failed ones don't
    const sum = costSummary(all);
    expect(sum.images).toBe(2);
    expect(sum.total).toBeCloseTo(0.07);
    expect(sum.byModel).toEqual({ m1: { cost: expect.closeTo(0.07), images: 2 } });
  });

  it('removes only files inside out/', async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(path.join(OUT_DIR, 'gone.png'), 'x');
    const outside = path.join(OUT_DIR, '..', 'keep.txt');
    await fs.writeFile(outside, 'x');
    const removed = await removeFiles([
      entry({ file: 'gone.png' }),
      entry({ file: '../keep.txt' }),
      entry({ file: 'missing.png' }),
      entry({ file: null }),
    ]);
    expect(removed).toEqual(['gone.png']);
    await expect(fs.stat(outside)).resolves.toBeTruthy();
  });

  it('counts the cost of charged failures, but not as results', () => {
    const sum = costSummary([
      entry({ model: 'm1', cost: 0.04 }),
      entry({ model: 'm1', ok: false, cost: 0.03 }),
      entry({ model: 'm2', ok: false, cost: null }),
    ]);
    expect(sum).toEqual({ total: expect.closeTo(0.07), images: 1, byModel: { m1: { cost: 0.07, images: 1 } } });
  });

  it('counts the cost of voice previews and transcriptions, but not as results', () => {
    const sum = costSummary([
      entry({ model: 'tts', cost: 0.01 }),
      entry({ model: 'tts', cost: 0.002, demo: true }),
      entry({ model: 'whisper', cost: 0.001, demo: true, tool: 'transcribe' }),
    ]);
    expect(sum).toEqual({
      total: expect.closeTo(0.013),
      images: 1,
      byModel: { tts: { cost: expect.closeTo(0.012), images: 1 }, whisper: { cost: 0.001, images: 0 } },
    });
  });

  it('starts a new line after a cut-off last line', async () => {
    await fs.rm(MANIFEST, { force: true });
    await appendEntry(entry({ id: 'before' }));
    await fs.appendFile(MANIFEST, '{"id":"cut-off","ok":tr');
    await appendEntry(entry({ id: 'after' }));
    expect((await readEntries()).map((e) => e.id)).toEqual(['before', 'after']);
  });

  it('waits for the lock file of another process and takes over a stale one', async () => {
    await fs.rm(MANIFEST, { force: true });
    await fs.writeFile(LOCK, '99999');
    let done = false;
    const pending = appendEntry(entry({ id: 'waited' })).then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(false);
    await fs.rm(LOCK);
    await pending;
    expect((await readEntries()).map((e) => e.id)).toEqual(['waited']);

    // Left behind by a crashed process
    await fs.writeFile(LOCK, '99999');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(LOCK, old, old);
    expect(await updateEntry('waited', { cost: 0.5 })).toBe(true);
    expect((await readEntries())[0].cost).toBe(0.5);
    await expect(fs.stat(LOCK)).rejects.toThrow();
    // No temporary files are left over
    expect((await fs.readdir(OUT_DIR)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves a lock alone that another process took over meanwhile', async () => {
    await fs.rm(MANIFEST, { force: true });
    const append = fs.appendFile.bind(fs);
    // While this process writes, another one takes over the lock (e.g. because it considered it stale)
    const spy = vi.spyOn(fs, 'appendFile').mockImplementationOnce(async (...args: Parameters<typeof fs.appendFile>) => {
      expect(await fs.readFile(LOCK, 'utf8')).toMatch(new RegExp(`^${process.pid}-`));
      await fs.writeFile(LOCK, 'other-process');
      return append(...args);
    });
    try {
      await appendEntry(entry({ id: 'mine' }));
    } finally {
      spy.mockRestore();
    }
    expect(await fs.readFile(LOCK, 'utf8')).toBe('other-process');
    await fs.rm(LOCK);
    expect((await readEntries()).map((e) => e.id)).toEqual(['mine']);
  });

  it('keeps a fresh lock that replaced the stale one before the takeover', async () => {
    await fs.rm(MANIFEST, { force: true });
    await fs.writeFile(LOCK, 'crashed');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(LOCK, old, old);
    const rename = fs.rename.bind(fs);
    // Between reading the stale lock and moving it, another process replaced it with its own fresh lock
    const spy = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      await fs.writeFile(LOCK, 'fresh-owner');
      return rename(from, to);
    });
    let done = false;
    const pending = appendEntry(entry({ id: 'later' })).then(() => {
      done = true;
    });
    await tick();
    spy.mockRestore();
    expect(done).toBe(false);
    expect(await fs.readFile(LOCK, 'utf8')).toBe('fresh-owner');
    expect((await fs.readdir(OUT_DIR)).filter((f) => f.endsWith('.stale'))).toEqual([]);
    await fs.rm(LOCK);
    await pending;
    expect((await readEntries()).map((e) => e.id)).toEqual(['later']);
  });

  it('keeps entries another process appends while this one rewrites', async () => {
    await fs.rm(MANIFEST, { force: true });
    await appendEntry(entry({ id: 'own' }));
    const script = `const { appendEntry } = await import(${JSON.stringify(new URL('./manifest.ts', import.meta.url).href)});
      for (let i = 0; i < 40; i++) await appendEntry({ id: 'child-' + i, runId: 'child', ok: true });`;
    const child = promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
    let finished = false;
    void child.finally(() => {
      finished = true;
    });
    let rewrites = 0;
    while (!finished) {
      await updateEntry('own', { cost: rewrites });
      rewrites++;
    }
    await child;
    const ids = (await readEntries()).map((e) => e.id);
    expect(ids.filter((id) => id?.startsWith('child-'))).toHaveLength(40);
    expect(ids[0]).toBe('own');
    expect(rewrites).toBeGreaterThan(0);
  });

  it('finds debug records that no remaining entry refers to', async () => {
    await fs.rm(MANIFEST, { force: true });
    for (const e of [
      entry({ id: 's1', debugId: 'dbg-shared' }),
      entry({ id: 's2', debugId: 'dbg-shared' }),
      entry({ id: 'own', debugId: 'dbg-own' }),
      entry({ id: 'none' }),
    ]) {
      await appendEntry(e);
    }
    const first = await markDeleted((e) => e.id === 's1' || e.id === 'own' || e.id === 'none');
    expect((await unusedDebugIds(first)).sort()).toEqual(['dbg-own']);
    const second = await markDeleted((e) => e.id === 's2');
    expect(await unusedDebugIds(second)).toEqual(['dbg-shared']);
    expect(await unusedDebugIds([])).toEqual([]);
  });

  it('finds uploads that only the deleted entries used', () => {
    const a = 'uploads/0123456789abcdef.jpg';
    const b = 'uploads/fedcba9876543210.jpg';
    const deleted = [
      entry({ id: 'd1', deleted: 'now', extraRefs: [a, b, 'result.png', 'uploads/../manifest.jsonl'] }),
      entry({ id: 'd2', deleted: 'now', extraRefs: [b] }),
    ];
    const remaining = [entry({ id: 'r', extraRefs: [b] }), entry({ id: 'old', deleted: 'earlier', extraRefs: [a] })];
    expect(unusedUploads(deleted, [...deleted, ...remaining])).toEqual(['0123456789abcdef.jpg']);
    expect(unusedUploads(deleted, deleted).sort()).toEqual(['0123456789abcdef.jpg', 'fedcba9876543210.jpg']);
    expect(unusedUploads([entry({ extraRefs: ['a.png'] })], [])).toEqual([]);
  });
});
