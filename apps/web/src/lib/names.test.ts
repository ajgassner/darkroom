import { describe, expect, it } from 'vitest';
import { folderName, newItem, selectionAfterDelete, slugify } from './names';

// Same rule as validName() in packages/core/src/refs.ts (the web UI may not import code from core)
const validName = (name: string) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(name) && !name.includes('..');

describe('slugify', () => {
  it('turns display names into folder names', () => {
    expect(slugify('Max Müller')).toBe('max-mueller');
    expect(slugify('Größe & Öl')).toBe('groesse-oel');
    expect(slugify('ÄÖÜ ẞ')).toBe('aeoeue-ss');
    expect(slugify('  Café  Crème! ')).toBe('cafe-creme');
    expect(slugify('ACME Inc.')).toBe('acme-inc');
    expect(slugify('ag_logo v2.1')).toBe('ag_logo-v2-1');
    expect(slugify('max')).toBe('max');
  });

  it('returns nothing for names without letters or digits', () => {
    expect(slugify('')).toBe('');
    expect(slugify(' -- ! ')).toBe('');
    expect(slugify('日本')).toBe('');
  });

  it('only produces names the server accepts', () => {
    const inputs = ['Max Müller', '..', '../etc', '.hidden', '-a-', 'x'.repeat(80), `${'a'.repeat(63)} b`, 'a/b\\c'];
    for (const input of inputs) {
      const name = slugify(input);
      expect(name.length).toBeLessThanOrEqual(64);
      if (name) expect(validName(name), `${input} → ${name}`).toBe(true);
      expect(name).not.toMatch(/-$/);
    }
  });
});

describe('folderName', () => {
  it('reports empty and taken names', () => {
    expect(folderName('Max Müller', ['anna'])).toEqual({ name: 'max-mueller', error: null });
    expect(folderName('!!', [])).toEqual({ name: '', error: 'empty' });
    expect(folderName('Anna', ['Anna'])).toEqual({ name: 'anna', error: 'taken' });
  });
});

describe('newItem', () => {
  it('shows the folder, or why the name cannot be used', () => {
    expect(newItem('  ', [])).toEqual({ label: '', name: '', ok: false, hint: null });
    expect(newItem(' Max Müller ', [])).toEqual({
      label: 'Max Müller',
      name: 'max-mueller',
      ok: true,
      hint: { key: 'newItem.folder', invalid: false },
    });
    expect(newItem('?!', [])).toMatchObject({ ok: false, hint: { key: 'newItem.empty', invalid: true } });
    expect(newItem('max', ['max'])).toMatchObject({ ok: false, hint: { key: 'newItem.taken', invalid: true } });
  });
});

describe('selectionAfterDelete', () => {
  it('selects the next item, else the previous one, else none', () => {
    expect(selectionAfterDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(selectionAfterDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(selectionAfterDelete(['a'], 'a')).toBeNull();
    expect(selectionAfterDelete(['a', 'b'], 'x')).toBe('a');
  });
});
