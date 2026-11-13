import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeOpenRouter, testImage } from '../test/fake-openrouter.ts';
import { OUT_DIR } from './config.ts';
import { readEntries } from './manifest.ts';
import { importImage, runTool } from './tools.ts';

const SOURCE = 'source.png';

beforeAll(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, SOURCE), await testImage({ width: 400, height: 200 }));
});

async function size(file: string | null) {
  const m = await sharp(path.join(OUT_DIR, file as string)).metadata();
  return [m.width, m.height];
}

describe('local tools', () => {
  it('crops to the target aspect ratio (default 1:1)', async () => {
    const [entry] = await runTool({ tool: 'crop', source: SOURCE, options: { aspect: '3:4' } });
    expect(entry).toMatchObject({
      ok: true,
      model: 'local/sharp',
      cost: 0,
      prompt: 'Crop to 3:4 (150×200)',
      toolOptions: { aspect: '3:4', position: 'attention' },
      source: SOURCE,
    });
    expect(await size(entry.file)).toEqual([150, 200]);
    expect(entry.file).toMatch(/^[^/]+_crop_3x4\.png$/);

    const [square] = await runTool({ tool: 'crop', source: SOURCE, options: { position: 'center' } });
    expect(await size(square.file)).toEqual([200, 200]);
  });

  it('resizes by factor (default 2) or to a width', async () => {
    const [double] = await runTool({ tool: 'resize', source: SOURCE });
    expect(double).toMatchObject({ prompt: 'Resize to 800×400 (local)', toolOptions: { factor: '2' } });
    expect(await size(double.file)).toEqual([800, 400]);

    const [narrow] = await runTool({ tool: 'resize', source: SOURCE, options: { width: '100' } });
    expect(await size(narrow.file)).toEqual([100, 50]);
  });

  it('records invalid options as failed entries', async () => {
    const [entry] = await runTool({ tool: 'resize', source: SOURCE, options: { width: '5' } });
    expect(entry).toMatchObject({ ok: false, errorCode: 'invalid_width', cost: null, file: null });
    const [crop] = await runTool({ tool: 'crop', source: SOURCE, options: { aspect: 'wide' } });
    expect(crop).toMatchObject({ ok: false, errorCode: 'invalid_aspect' });
    expect((await readEntries()).filter((e) => !e.ok)).toHaveLength(2);
  });

  it('rejects crop aspect ratios that are not two positive whole numbers', async () => {
    const before = await fs.readdir(path.dirname(OUT_DIR));
    for (const aspect of ['3:2:/../../../../tmp/evil', '3:2/../../evil', '../3:2', '0:1', '3:-2', '1.5:1', '3:2 ']) {
      const [entry] = await runTool({ tool: 'crop', source: SOURCE, options: { aspect } });
      expect(entry, aspect).toMatchObject({ ok: false, errorCode: 'invalid_aspect', file: null });
    }
    // Nothing was written next to out/
    expect(await fs.readdir(path.dirname(OUT_DIR))).toEqual(before);
  });

  it('rejects unknown tools and paths outside out/', async () => {
    await expect(runTool({ tool: 'sharpen', source: SOURCE })).rejects.toMatchObject({ code: 'unknown_tool' });
    await expect(runTool({ tool: 'crop', source: '../x.png' })).rejects.toMatchObject({ code: 'invalid_path' });
  });
});

describe('AI tools', () => {
  it('relights via the image API with the source as image 1', async () => {
    const api = fakeOpenRouter();
    const [entry] = await runTool({
      tool: 'relight',
      source: SOURCE,
      model: 'test/zdr',
      options: { preset: 'golden' },
    });
    const body = api.imageCalls()[0].body as { prompt: string; input_references: unknown[]; aspect_ratio: string };
    expect(body.prompt).toMatch(/^Edit reference image 1/);
    expect(body.prompt).toContain('warm golden-hour sunlight');
    expect(body.input_references).toHaveLength(1);
    // Source is 2:1, the model offers 1:1, 3:4 and 16:9 → closest is 16:9
    expect(body.aspect_ratio).toBe('16:9');
    expect(entry).toMatchObject({
      ok: true,
      tool: 'relight',
      source: SOURCE,
      prompt: 'Relight: golden hour',
      toolOptions: { preset: 'golden' },
    });
  });

  it.each([
    ['expand', {}, 'Expand to 16:9', 'Extend the canvas of image 1 to a 16:9 format'],
    ['upscale', { note: 'keep the logo' }, 'Upscale (AI, 4K)', 'Additional instruction: keep the logo'],
    ['cleanup', {}, 'Clean up background', 'remove distracting objects'],
    ['relight', { custom: 'candle light', preset: 'night' }, 'Relight: candle light', 'with candle light.'],
    ['relight', { preset: 'unknown' }, 'Relight: studio light', 'softbox key light'],
  ])('%s %j', async (tool, options, label, promptPart) => {
    const api = fakeOpenRouter();
    const [entry] = await runTool({ tool, source: SOURCE, model: 'test/zdr', options });
    expect(entry.prompt).toBe(label);
    expect((api.imageCalls()[0].body as { prompt: string }).prompt).toContain(promptPart);
  });
});

describe('importImage', () => {
  it('adds an own image to the gallery (PNG with transparency, JPEG otherwise)', async () => {
    const png = await importImage(
      `data:image/png;base64,${(await testImage({ alpha: true })).toString('base64')}`,
      'My Logo.png',
    );
    expect(png).toMatchObject({ ok: true, tool: 'import', model: 'local/upload', mediaType: 'image/png' });
    expect(png.file).toMatch(/_upload_My_Logo\.png$/);

    const jpg = await importImage(`data:image/png;base64,${(await testImage()).toString('base64')}`, '');
    expect(jpg).toMatchObject({ mediaType: 'image/jpeg', prompt: 'Uploaded: image', params: { width: 16 } });

    await expect(importImage('nope', 'x')).rejects.toMatchObject({ code: 'invalid_data_url' });
    await expect(importImage('data:image/png;base64,AAAA', 'x')).rejects.toMatchObject({ code: 'image_unreadable' });
  });
});
