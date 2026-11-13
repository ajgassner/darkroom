import { describe, expect, it } from 'vitest';
import { searchFilter } from './term.ts';

const option = { value: 'google/gemini-3-pro-image', label: 'google/gemini-3-pro-image', hint: '★ recommended' };

describe('multi-select search', () => {
  it('matches label, hint or value regardless of case', () => {
    const filter = searchFilter([]);
    expect(filter.call(undefined, 'GEMINI', option)).toBe(true);
    expect(filter.call(undefined, 'recommended', option)).toBe(true);
    expect(filter.call(undefined, 'seedream', option)).toBe(false);
    expect(filter.call(undefined, 'x', { value: 'x/y' })).toBe(true);
  });

  it('drops the remembered selection once the user types, unless it was changed', () => {
    const prompt = { selectedValues: ['a/one', 'b/two'] };
    const filter = searchFilter(['b/two', 'a/one']);
    // clack checks its placeholder on every key: that is no typing
    filter.call(prompt, 'type to search', option);
    expect(prompt.selectedValues).toEqual(['a/one', 'b/two']);
    filter.call(prompt, 's', option);
    expect(prompt.selectedValues).toEqual([]);
    // Only the first search: what the user picks afterwards stays
    prompt.selectedValues = ['c/three'];
    filter.call(prompt, 'se', option);
    expect(prompt.selectedValues).toEqual(['c/three']);

    const changed = { selectedValues: ['a/one', 'c/three'] };
    searchFilter(['a/one']).call(changed, 'x', option);
    expect(changed.selectedValues).toEqual(['a/one', 'c/three']);
  });
});
