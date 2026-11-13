import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST, OUT_DIR } from './config.ts';
import type { ManifestEntry } from './contract.ts';
import { appendEntry, costSummary, markDeleted, readEntries, removeFiles, updateEntry } from './manifest.ts';

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
});
