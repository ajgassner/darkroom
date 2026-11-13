import { describe, expect, it } from 'vitest';
import { revealTop } from './scroll';

describe('revealTop', () => {
  it('puts the element below the sticky bars with a small gap', () => {
    expect(revealTop(1200, 52)).toBe(1136);
    expect(revealTop(1200.4, 52, 0)).toBe(1148);
  });

  it('never scrolls above the page top', () => {
    expect(revealTop(230, 52 + 200)).toBe(0);
  });
});
