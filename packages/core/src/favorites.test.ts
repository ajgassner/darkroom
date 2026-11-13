import fs from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeOpenRouter } from '../test/fake-openrouter.ts';
import { FAVORITES_FILE } from './config.ts';
import { inCatalog, modelKindOf, readFavorites, setFavorite } from './favorites.ts';

const file = () => fs.readFile(FAVORITES_FILE, 'utf8').then(JSON.parse);

beforeEach(() => fs.rm(FAVORITES_FILE, { force: true }));

describe('favorites.json', () => {
  it('reads as empty lists without a file and adds and removes favorites per kind', async () => {
    expect(await readFavorites()).toEqual({ image: [], speech: [], music: [] });
    await setFavorite('image', 'a/one', true);
    await setFavorite('image', 'a/two', true);
    await setFavorite('image', 'a/one', true); // no duplicate
    await setFavorite('speech', 's/one', true);
    expect(await setFavorite('image', 'a/one', false)).toEqual({ image: ['a/two'], speech: ['s/one'], music: [] });
    expect(await file()).toEqual({ image: ['a/two'], speech: ['s/one'], music: [] });
  });

  it('keeps every change when saves overlap, and unknown keys and ids in the file', async () => {
    await fs.writeFile(FAVORITES_FILE, JSON.stringify({ image: ['gone/model', 7], note: 'mine' }));
    const ids = Array.from({ length: 6 }, (_, i) => `m/${i}`);
    await Promise.all(ids.map((id) => setFavorite('music', id, true)));
    expect((await readFavorites()).music.sort()).toEqual(ids);
    expect(await file()).toMatchObject({ image: ['gone/model'], note: 'mine' });
  });

  it('refuses to overwrite a damaged file but reads it as no favorites', async () => {
    await fs.writeFile(FAVORITES_FILE, '{ broken');
    expect(await readFavorites()).toEqual({ image: [], speech: [], music: [] });
    await expect(setFavorite('image', 'a/one', true)).rejects.toMatchObject({ code: 'favorites_invalid' });
    expect(await fs.readFile(FAVORITES_FILE, 'utf8')).toBe('{ broken');
  });
});

describe('model kinds', () => {
  it('finds the catalog of a model and rejects unknown models', async () => {
    fakeOpenRouter();
    expect(await modelKindOf('test/zdr')).toBe('image');
    expect(await modelKindOf('test/clone')).toBe('speech');
    expect(await modelKindOf('test/lyria')).toBe('music');
    expect(await inCatalog('image', 'test/clone')).toBe(false);
    await expect(modelKindOf('typo/model')).rejects.toMatchObject({ code: 'unknown_model' });
  });
});
