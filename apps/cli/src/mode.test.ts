import { describe, expect, it } from 'vitest';
import { jsonRequested } from './mode.ts';

describe('JSON mode', () => {
  it('is asked for by --json before a --', () => {
    expect(jsonRequested(['models', '--json'])).toBe(true);
    expect(jsonRequested(['gen', '--json', '-m', 'a/b', 'a cat'])).toBe(true);
    expect(jsonRequested(['gen', 'a cat'])).toBe(false);
    expect(jsonRequested(['gen', '--', 'explain', '--json'])).toBe(false);
    expect(jsonRequested(['gen', '--json=1'])).toBe(false);
  });
});
