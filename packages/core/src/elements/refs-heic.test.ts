// HEIC photos copied into refs/<name>/ by hand: converted (here by a fake converter) before sharp reads them.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { testImage } from '../../test/fake-openrouter.ts';
import { REFS_DIR } from '../config.ts';
import { decodable } from '../image/heic.ts';
import { elementReferences, saveElement, thumbnail } from './refs.ts';

vi.mock('../image/heic.ts', () => ({ decodable: vi.fn() }));

const FAKE_HEIC = Buffer.from('fake-heic-content');
const convert = vi.mocked(decodable);

describe('HEIC element photos', () => {
  it('converts HEIC/HEIF photos for references and thumbnails, once per file version', async () => {
    const jpeg = await testImage({ width: 400, height: 300, format: 'jpeg' });
    convert.mockImplementation(async (buf) => (buf.equals(FAKE_HEIC) ? jpeg : buf));
    await saveElement('iphone', {});
    const dir = path.join(REFS_DIR, 'iphone');
    await fs.writeFile(path.join(dir, 'IMG_0001.HEIC'), FAKE_HEIC);
    await fs.writeFile(path.join(dir, 'IMG_0002.heif'), FAKE_HEIC);

    const { info, urls } = await elementReferences('iphone', 200);
    expect(info.photos).toEqual(['IMG_0001.HEIC', 'IMG_0002.heif']);
    for (const url of urls) {
      const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata();
      expect(meta).toMatchObject({ format: 'jpeg', width: 200, height: 150 });
    }
    const thumb = await sharp(await thumbnail(path.join(dir, 'IMG_0001.HEIC'), 64)).metadata();
    expect(thumb).toMatchObject({ format: 'jpeg', width: 64, height: 64 });
    expect(convert).toHaveBeenCalledTimes(2);

    // Another size and another thumbnail reuse the conversion; a changed file is converted again
    await elementReferences('iphone', 100);
    await thumbnail(path.join(dir, 'IMG_0002.heif'));
    expect(convert).toHaveBeenCalledTimes(2);
    const later = new Date(Date.now() + 5000);
    await fs.utimes(path.join(dir, 'IMG_0001.HEIC'), later, later);
    await thumbnail(path.join(dir, 'IMG_0001.HEIC'));
    expect(convert).toHaveBeenCalledTimes(3);
  });

  it('reports a failed conversion instead of a sharp error', async () => {
    convert.mockRejectedValue(Object.assign(new Error('HEIC conversion failed: x'), { code: 'heic_failed' }));
    await saveElement('broken-heic', {});
    await fs.writeFile(path.join(REFS_DIR, 'broken-heic', 'a.heic'), Buffer.from('other'));
    await expect(elementReferences('broken-heic', 200)).rejects.toMatchObject({ code: 'heic_failed' });
  });
});
