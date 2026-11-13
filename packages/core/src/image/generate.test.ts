import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakeOpenRouter, json, MODELS, testImage } from '../../test/fake-openrouter.ts';
import { OUT_DIR, UPLOADS_DIR } from '../config.ts';
import type { ElementInfo, RunEvent } from '../contract.ts';
import { addPhoto, DEFAULT_INSTRUCTIONS, saveElement } from '../elements/refs.ts';
import { readEntries } from '../storage/manifest.ts';
import { runGeneration } from './generate.ts';
import { fitParams, maxRefs } from './params.ts';
import { composePrompt } from './prompt.ts';

const zdrModel = MODELS[0];
const codes = (r: { notices: { code: string }[] }) => r.notices.map((n) => n.code);

describe('fitParams', () => {
  it('passes values through for unknown models, with a notice', () => {
    const r = fitParams(undefined, { aspectRatio: '4:5', seed: 7 });
    expect(r.params).toEqual({ aspect_ratio: '4:5', seed: 7 });
    expect(codes(r)).toEqual(['model_unknown']);
  });

  it('keeps supported values', () => {
    const r = fitParams(zdrModel, { aspectRatio: '3:4', resolution: '2K', outputFormat: 'jpeg', seed: 1 });
    expect(r.params).toEqual({ aspect_ratio: '3:4', resolution: '2K', output_format: 'jpeg', seed: 1 });
    expect(r.notices).toEqual([]);
  });

  it('picks the nearest aspect ratio and size', () => {
    const r = fitParams(zdrModel, { aspectRatio: '4:5', resolution: '4K' });
    expect(r.params).toEqual({ aspect_ratio: '3:4', resolution: '2K' });
    expect(r.notices).toEqual([
      { code: 'aspect_adjusted', params: { from: '4:5', to: '3:4' } },
      { code: 'size_adjusted', params: { from: '4K', to: '2K' } },
    ]);
  });

  it('drops unsupported parameters with notices', () => {
    const model = MODELS[2]; // no parameters at all
    const r = fitParams(model, {
      aspectRatio: '1:1',
      resolution: '1K',
      outputFormat: 'webp',
      quality: 'high',
      seed: 3,
    });
    expect(r.params).toEqual({});
    expect(codes(r)).toEqual(['aspect_unsupported', 'size_unsupported', 'format_unsupported']);
  });

  it('reads the reference limit', () => {
    expect(maxRefs(zdrModel)).toBe(3);
    expect(maxRefs(MODELS[2])).toBe(0);
    expect(maxRefs(undefined)).toBeNull();
  });
});

describe('composePrompt', () => {
  const el = (over: Partial<ElementInfo>): ElementInfo => ({
    name: 'max',
    label: 'Max',
    type: 'person',
    instructions: '',
    photos: [],
    ...over,
  });
  const max = el({});
  const logo = el({ name: 'acme', label: 'ACME', type: 'logo', instructions: 'Use the white version.' });

  it('without prefix only replaces mentions', () => {
    expect(composePrompt('@max holds the @acme sign', [{ info: max, count: 2 }], 0, false, false)).toBe(
      'Max holds the @acme sign',
    );
  });

  it('maps reference images to elements; non-person elements are referenced by image number', () => {
    const out = composePrompt(
      'Photo of @max with the @acme logo on the wall',
      [
        { info: max, count: 2 },
        { info: logo, count: 1 },
      ],
      1,
      true,
      false,
    );
    expect(out).toContain('Reference image 1: additional reference');
    expect(out).toContain('Reference images 2-3: Max, a person.');
    expect(out).toMatch(/Reference image 4: a logo\. .+ Use the white version\./);
    expect(out).toContain('Do not write element names');
    expect(out).toContain('photorealistic photograph');
    expect(out).toMatch(/Task: Photo of Max with the \[logo, reference image 4\] logo on the wall$/);
  });

  it('uses the legacy template for a single person', () => {
    const tpl = el({ instructions: DEFAULT_INSTRUCTIONS });
    const out = composePrompt('in the office', [{ info: tpl, count: 3 }], 0, true, false);
    expect(out).toContain('in the office');
    expect(out).not.toContain('Task:');
  });

  it('inserts prompt and label literally (no $ replacement patterns)', () => {
    const tpl = el({ label: 'Max $& Co', instructions: DEFAULT_INSTRUCTIONS });
    const out = composePrompt('costs $$5 and $&', [{ info: tpl, count: 1 }], 0, true, false);
    expect(out).toContain('costs $$5 and $&');
    const custom = el({ label: 'A$$B', type: 'logo', instructions: 'Show {label} large.' });
    expect(composePrompt('$& @max', [{ info: custom, count: 1 }], 0, true, false)).toContain('Show A$$B large.');
  });

  it('describes the image to edit in edit mode', () => {
    const out = composePrompt('make it brighter', [], 2, false, true);
    expect(out).toMatch(/^Edit reference image 1/);
    expect(out).toContain('Reference images 2: additional references.');
    expect(out.endsWith('\nmake it brighter')).toBe(true);
  });
});

describe('runGeneration', () => {
  it('saves results with cost and restricts requests to ZDR providers', async () => {
    const api = fakeOpenRouter();
    const events: RunEvent['type'][] = [];
    const entries = await runGeneration(
      { prompt: 'a red square', models: ['test/zdr'], count: 2, aspectRatio: '4:5' },
      (e) => events.push(e.type),
    );

    // n max. 1 → two calls for two images
    expect(api.imageCalls()).toHaveLength(2);
    expect(api.imageCalls()[0].body).toMatchObject({
      model: 'test/zdr',
      aspect_ratio: '3:4',
      provider: { only: ['zdr-provider'], allow_fallbacks: false },
    });
    expect(events).toEqual(['start', 'image', 'image', 'done']);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e).toMatchObject({ ok: true, cost: 0.04, generationId: 'gen-123', mediaType: 'image/png' });
      expect(e.notices).toEqual([{ code: 'aspect_adjusted', params: { from: '4:5', to: '3:4' } }]);
      await expect(fs.stat(path.join(OUT_DIR, e.file as string))).resolves.toBeTruthy();
    }
    expect((await readEntries()).filter((e) => e.runId === entries[0].runId)).toHaveLength(2);
  });

  it('does not call models without a matching ZDR endpoint', async () => {
    const api = fakeOpenRouter();
    const entries = await runGeneration({ prompt: 'p', models: ['test/open', 'test/safety'], privacy: 'zdr-strict' });
    expect(api.imageCalls()).toHaveLength(0);
    expect(entries.map((e) => e.errorCode).sort()).toEqual(['privacy_blocked_strict', 'privacy_blocked_strict']);

    const relaxed = await runGeneration({ prompt: 'p', models: ['test/safety'], privacy: 'zdr' });
    expect(relaxed[0].ok).toBe(true);
    const off = await runGeneration({ prompt: 'p', models: ['test/open'], privacy: 'off' });
    expect(off[0]).toMatchObject({ ok: true, providerRestriction: null });
  });

  it('sends element photos for @mentions within the reference limit', async () => {
    await saveElement('max', { label: 'Max' });
    await saveElement('acme', { label: 'ACME', type: 'logo', instructions: '' });
    for (let i = 0; i < 3; i++) await addPhoto('max', `p${i}.png`, await testImage({ width: 20 + i }));
    await addPhoto('acme', 'logo.png', await testImage({ alpha: true }));

    const api = fakeOpenRouter();
    const [entry] = await runGeneration({ prompt: '@Max in front of the @acme sign', models: ['test/zdr'] });

    // Limit 3: round-robin keeps at least one image per element
    const refs = (api.imageCalls()[0].body as { input_references: unknown[] }).input_references;
    expect(refs).toHaveLength(3);
    expect(entry).toMatchObject({ elements: ['max', 'acme'], refCount: 3 });
    expect(entry.notices).toEqual([{ code: 'refs_truncated', params: { limit: 3, sent: 3, total: 4 } }]);
    expect(entry.fullPrompt).toContain('Reference images 1-2: Max, a person.');
    expect(entry.fullPrompt).toContain('[logo, reference image 3]');
  });

  it('records upstream errors and aborts as failed entries', async () => {
    fakeOpenRouter({ images: () => json({ error: { message: 'content filtered' } }, { status: 400 }) });
    const [failed] = await runGeneration({ prompt: 'p', models: ['test/zdr'] });
    expect(failed).toMatchObject({ ok: false, error: 'HTTP 400: content filtered', debugId: expect.any(String) });

    const ac = new AbortController();
    fakeOpenRouter({
      images: () => {
        ac.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    });
    const [aborted] = await runGeneration({ prompt: 'p', models: ['test/zdr'] }, () => {}, ac.signal);
    expect(aborted).toMatchObject({ ok: false, errorCode: 'aborted' });
  });

  it('gives runs in the same second their own files', async () => {
    fakeOpenRouter();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    try {
      const runs = await Promise.all([1, 2].map(() => runGeneration({ prompt: 'p', models: ['test/zdr'] })));
      const files = runs.flat().map((e) => e.file as string);
      expect(new Set(files).size).toBe(2);
      for (const f of files) {
        expect(f).toMatch(/^2026-11-13T10-00-00_[0-9a-f]{6}_test_zdr_1\.png$/);
        await expect(fs.stat(path.join(OUT_DIR, f))).resolves.toBeTruthy();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the cost of a charged response without an image', async () => {
    fakeOpenRouter({
      images: () =>
        json({ data: [], usage: { cost: 0.03 }, provider: 'ZdrCo' }, { headers: { 'x-generation-id': 'gen-empty' } }),
    });
    let doneCost = -1;
    const [failed] = await runGeneration({ prompt: 'p', models: ['test/zdr'] }, (e) => {
      if (e.type === 'done') doneCost = e.cost;
    });
    expect(failed).toMatchObject({
      ok: false,
      errorCode: 'no_image_data',
      cost: 0.03,
      callCost: 0.03,
      generationId: 'gen-empty',
      provider: 'ZdrCo',
      debugId: expect.any(String),
    });
    expect(doneCost).toBe(0.03);
  });

  it('records the cost of images that could not be saved on the error entry', async () => {
    fakeOpenRouter();
    const write = fs.writeFile;
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation((file, ...rest) => {
      if (String(file).endsWith('_2.png')) return Promise.reject(new Error('disk full'));
      return write(file, ...rest);
    });
    try {
      const entries = await runGeneration({ prompt: 'p', models: ['test/safety'], count: 4, privacy: 'off' });
      expect(entries.map((e) => e.ok)).toEqual([true, false]);
      expect(entries[0]).toMatchObject({ cost: 0.01, callCost: 0.04 });
      expect(entries[1]).toMatchObject({ error: 'disk full', callCost: 0.04, generationId: 'gen-123' });
      expect(entries[1].cost).toBeCloseTo(0.03);
      expect(entries[1].debugId).toBe(entries[0].debugId);
    } finally {
      spy.mockRestore();
    }
  });

  it('stores uploaded references once under their content hash, complete even for concurrent runs', async () => {
    fakeOpenRouter();
    const dataUrl = `data:image/png;base64,${(await testImage({ width: 64, height: 48 })).toString('base64')}`;
    const opts = { prompt: 'p', models: ['test/zdr'], extraRefs: [{ dataUrl }] };
    const runs = await Promise.all([1, 2, 3].map(() => runGeneration(opts)));
    const labels = new Set(runs.flat().flatMap((e) => e.extraRefs));
    expect(labels.size).toBe(1);
    const [label] = labels;
    expect(label).toMatch(/^uploads\/[0-9a-f]{16}\.jpg$/);
    expect(await fs.readdir(UPLOADS_DIR)).toEqual([path.basename(label)]);
    const file = path.join(UPLOADS_DIR, path.basename(label));
    const complete = await fs.readFile(file);

    // A file cut off earlier (e.g. by a crash) is replaced
    await fs.writeFile(file, complete.subarray(0, 10));
    await runGeneration(opts);
    expect(await fs.readFile(file)).toEqual(complete);
    expect(await fs.readdir(UPLOADS_DIR)).toEqual([path.basename(label)]);
  });

  it('validates the input before calling the API', async () => {
    const api = fakeOpenRouter();
    await expect(runGeneration({ prompt: '  ', models: ['test/zdr'] })).rejects.toMatchObject({
      code: 'prompt_missing',
    });
    await expect(runGeneration({ prompt: 'p', models: [] })).rejects.toMatchObject({ code: 'no_model' });
    expect(api.calls).toHaveLength(0);
  });

  it('rejects unknown models before the privacy check, without calling them', async () => {
    const api = fakeOpenRouter();
    const before = (await readEntries()).length;
    for (const privacy of ['zdr', 'off'] as const) {
      await expect(runGeneration({ prompt: 'p', models: ['test/zdr', 'test/imagex'], privacy })).rejects.toMatchObject({
        code: 'unknown_model',
        params: { model: 'test/imagex' },
        message: expect.stringContaining('darkroom models'),
      });
    }
    expect(api.imageCalls()).toHaveLength(0);
    expect(await readEntries()).toHaveLength(before);
  });

  it('keeps extra images of a call under their own names', async () => {
    // test/safety allows n up to 4; the provider returns one image more than asked for in every call
    fakeOpenRouter({
      images: async (body) => {
        const b64 = (await testImage()).toString('base64');
        const n = (typeof body.n === 'number' ? body.n : 1) + 1;
        return json({ data: Array.from({ length: n }, () => ({ b64_json: b64 })), usage: { cost: 0.06 } });
      },
    });
    const entries = await runGeneration({ prompt: 'p', models: ['test/safety'], count: 2, privacy: 'off' });
    expect(entries.map((e) => e.ok)).toEqual([true, true, true]);
    const names = entries.map((e) => (e.file as string).replace(/^.*_test_safety_/, ''));
    expect(names).toEqual(['1.png', '2.png', '1-3.png']);
    for (const e of entries) await expect(fs.stat(path.join(OUT_DIR, e.file as string))).resolves.toBeTruthy();
    expect(entries.reduce((s, e) => s + (e.cost ?? 0), 0)).toBeCloseTo(0.06);
  });

  it('does not let extra images take the names of the next call', async () => {
    // test/zdr allows n=1, so count 2 needs two calls; each returns two images
    fakeOpenRouter({
      images: async () => {
        const b64 = (await testImage()).toString('base64');
        return json({ data: [{ b64_json: b64 }, { b64_json: b64 }], usage: { cost: 0.04 } });
      },
    });
    const entries = await runGeneration({ prompt: 'p', models: ['test/zdr'], count: 2 });
    expect(entries.every((e) => e.ok)).toBe(true);
    const names = entries.map((e) => (e.file as string).replace(/^.*_test_zdr_/, '')).sort();
    expect(names).toEqual(['1-2.png', '1.png', '2-2.png', '2.png']);
  });

  it('warns about @mentions without an element', async () => {
    await saveElement('lena', { label: 'Lena' });
    await addPhoto('lena', 'p.png', await testImage());
    const api = fakeOpenRouter();
    const [entry] = await runGeneration({
      prompt: 'photo of @lena and @nobody, mail info@example.com',
      models: ['test/zdr'],
    });
    expect(api.imageCalls()).toHaveLength(1);
    expect(entry).toMatchObject({ ok: true, elements: ['lena'], refCount: 1 });
    expect(entry.notices).toEqual([{ code: 'element_mention_unknown', params: { name: 'nobody' } }]);
    expect(entry.warnings).toEqual(['@nobody: no element with this name, mention ignored']);
  });
});
