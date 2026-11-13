import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { testImage } from '../test/fake-openrouter.ts';
import { REFS_DIR } from './config.ts';
import {
  addPhoto,
  DEFAULT_INSTRUCTIONS,
  deleteElement,
  deletePhoto,
  elementReferences,
  encodeImage,
  findMentions,
  getElement,
  isTemplate,
  listElements,
  photoPath,
  removeNamedDir,
  replaceMentions,
  SizedCache,
  saveElement,
  validName,
} from './refs.ts';

async function dataUrlSize(url: string) {
  const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata();
  return { width: meta.width, height: meta.height, format: meta.format, alpha: meta.hasAlpha };
}

describe('mentions', () => {
  const names = ['Max', 'ag-logo', 'office.v2'];

  it('finds known elements case-insensitively, once each, in prompt order', () => {
    expect(findMentions('Put the @AG-LOGO next to @max and @max again', names).known).toEqual(['ag-logo', 'Max']);
  });

  it('reports unknown names separately and ignores trailing punctuation', () => {
    expect(findMentions('Hi @max. Meet @nobody, see @office.v2! @Nobody again', names)).toEqual({
      known: ['Max', 'office.v2'],
      unknown: ['nobody'],
    });
  });

  it('does not treat e-mail addresses as mentions', () => {
    expect(findMentions('Mail max@office.v2 or a@b.com, then (@max)', names)).toEqual({
      known: ['Max'],
      unknown: [],
    });
  });

  it('replaces mentions by label and keeps unknown ones', () => {
    const labels = new Map([
      ['max', 'Max Mustermann'],
      ['ag-logo', '[logo, reference image 3]'],
    ]);
    expect(replaceMentions('@Max with @ag-logo and @other, mail max@ag-logo now', labels)).toBe(
      'Max Mustermann with [logo, reference image 3] and @other, mail max@ag-logo now',
    );
  });
});

describe('validName / isTemplate', () => {
  it.each(['me', 'ag-logo', 'office_2', 'a.b'])('accepts %s', (n) => expect(validName(n)).toBe(true));
  it.each(['', '../x', 'a/b', '.hidden', 'a..b', 'x'.repeat(65), 'ä'])('rejects %j', (n) =>
    expect(validName(n)).toBe(false),
  );

  it('detects the legacy person template', () => {
    expect(isTemplate(DEFAULT_INSTRUCTIONS)).toBe(true);
    expect(isTemplate('Use the white logo on dark backgrounds')).toBe(false);
  });
});

describe('element storage', () => {
  it('creates elements with defaults per type and lists them sorted', async () => {
    const person = await saveElement('zed', {});
    expect(person).toMatchObject({ name: 'zed', label: 'zed', type: 'person', instructions: DEFAULT_INSTRUCTIONS });

    const logo = await saveElement('acme', { label: 'ACME', type: 'logo', instructions: '' });
    expect(logo).toMatchObject({ label: 'ACME', type: 'logo', instructions: '', photos: [] });

    // Partial updates keep the other fields
    expect(await saveElement('acme', { instructions: 'white on dark' })).toMatchObject({
      label: 'ACME',
      type: 'logo',
      instructions: 'white on dark',
    });
    expect((await listElements()).map((e) => e.name)).toEqual(['acme', 'zed']);
  });

  it('falls back to person for an unknown type in element.json', async () => {
    await fs.mkdir(path.join(REFS_DIR, 'odd'), { recursive: true });
    await fs.writeFile(path.join(REFS_DIR, 'odd', 'element.json'), '{"type":"alien"}');
    expect((await getElement('odd')).type).toBe('person');
  });

  it('keeps every field when element.json is saved concurrently', async () => {
    await saveElement('busy', { type: 'logo' });
    await Promise.all([
      saveElement('busy', { label: 'Busy Inc.' }),
      saveElement('busy', { instructions: 'top left' }),
      saveElement('busy', { type: 'object' }),
    ]);
    expect(await getElement('busy')).toMatchObject({ label: 'Busy Inc.', instructions: 'top left', type: 'object' });
    const files = await fs.readdir(path.join(REFS_DIR, 'busy'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to overwrite a damaged element.json but still reads it with defaults', async () => {
    const file = path.join(REFS_DIR, 'broken', 'element.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"label": "Bro');
    expect(await getElement('broken')).toMatchObject({ label: 'broken', type: 'person' });
    await expect(saveElement('broken', { label: 'New' })).rejects.toMatchObject({
      code: 'element_config_invalid',
      params: { name: 'broken' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('{"label": "Bro');
  });

  it('reports missing elements and invalid names with codes', async () => {
    await expect(getElement('missing')).rejects.toMatchObject({ code: 'element_not_found' });
    await expect(getElement('../etc')).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(elementReferences('zed', 512)).rejects.toMatchObject({ code: 'element_no_photos' });
  });

  it('stores opaque photos as JPEG (max. 2048 px) and transparent ones as PNG', async () => {
    await saveElement('photos', {});
    const big = await addPhoto('photos', 'IMG 0001.png', await testImage({ width: 3000, height: 1500 }));
    const logo = await addPhoto('photos', 'logo.png', await testImage({ alpha: true }));
    expect(big).toMatch(/^\d+_IMG_0001\.jpg$/);
    expect(logo).toMatch(/_logo\.png$/);

    const stored = await sharp(photoPath('photos', big)).metadata();
    expect([stored.width, stored.height, stored.format]).toEqual([2048, 1024, 'jpeg']);
    expect((await getElement('photos')).photos).toEqual([big, logo].sort());

    const { urls } = await elementReferences('photos', 512);
    const sizes = await Promise.all(urls.map(dataUrlSize));
    expect(sizes).toContainEqual({ width: 512, height: 256, format: 'jpeg', alpha: false });
    expect(sizes).toContainEqual(expect.objectContaining({ format: 'png', alpha: true }));

    await deletePhoto('photos', logo);
    expect((await getElement('photos')).photos).toEqual([big]);
  });

  it.each(['../element.json', 'a/b.jpg', '.hidden.jpg', 'notes.txt'])('rejects photo path %j', (file) => {
    expect(() => photoPath('photos', file)).toThrow();
  });
});

describe('deleting elements', () => {
  it('removes refs/<name>/ with everything in it', async () => {
    await saveElement('temp', { label: 'Temp' });
    await addPhoto('temp', 'a.png', await testImage());
    await deleteElement('temp');
    await expect(fs.access(path.join(REFS_DIR, 'temp'))).rejects.toThrow();
    await expect(deleteElement('temp')).rejects.toMatchObject({ code: 'element_not_found', params: { name: 'temp' } });
  });

  it('refuses names that leave the folder, files and symlinks', async () => {
    const base = path.join(REFS_DIR, '..', 'rm-base');
    const outside = path.join(REFS_DIR, '..', 'rm-outside');
    await fs.mkdir(path.join(base, 'file-dir'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(base, 'plain'), 'x');
    await fs.symlink(outside, path.join(base, 'link'));
    const notFound = () => new Error('not found');
    for (const bad of ['..', '../rm-outside', '', '.']) {
      await expect(removeNamedDir(base, bad, notFound)).rejects.toMatchObject({ code: 'invalid_name' });
    }
    await expect(removeNamedDir(base, 'plain', notFound)).rejects.toThrow('not found');
    await expect(removeNamedDir(base, 'link', notFound)).rejects.toThrow('not found');
    await fs.access(outside);
    await removeNamedDir(base, 'file-dir', notFound);
    expect((await fs.readdir(base)).sort()).toEqual(['link', 'plain']);
  });
});

describe('encodeImage', () => {
  it('never upscales', async () => {
    const url = await encodeImage(await testImage({ width: 100, height: 50 }), 1024);
    expect(await dataUrlSize(url)).toMatchObject({ width: 100, height: 50, format: 'jpeg' });
  });
});

describe('SizedCache', () => {
  it('drops the least recently used values beyond its size limit', () => {
    const cache = new SizedCache(10);
    cache.set('a', 'aaaa');
    cache.set('b', 'bbbb');
    expect(cache.get('a')).toBe('aaaa'); // a is now the most recently used
    cache.set('c', 'cccc');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('aaaa');
    cache.set('a', 'AA'); // replacing frees the old size
    cache.set('d', 'dddd');
    expect([cache.get('a'), cache.get('c'), cache.get('d')]).toEqual(['AA', 'cccc', 'dddd']);
    // A value larger than the limit is still kept until the next one arrives
    cache.set('big', 'x'.repeat(20));
    expect(cache.get('big')).toHaveLength(20);
    expect(cache.get('d')).toBeUndefined();
  });
});
