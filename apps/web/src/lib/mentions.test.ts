import { describe, expect, it } from 'vitest';
import { activeElements, mentionKeyAction, mentionQuery, promptMentions } from './mentions';
import type { ElementInfo } from './types';

const el = (name: string): ElementInfo => ({ name, label: name, type: 'person', instructions: '', photos: [] });
const max = el('max');
const logo = el('ag-logo');

describe('promptMentions', () => {
  it('separates known and unknown mentions and ignores e-mail addresses', () => {
    expect(promptMentions('@Max with @ag-logo, @who and @who. Mail max@ag-logo.at', [max, logo])).toEqual({
      known: [max, logo],
      unknown: ['who'],
    });
  });

  it('puts the dropdown element first, without duplicates', () => {
    expect(activeElements('@max and @ag-logo', [max, logo], 'ag-logo')).toEqual([logo, max]);
    expect(activeElements('no mentions', [max], '')).toEqual([]);
  });
});

describe('mentionQuery', () => {
  it('detects an unfinished mention before the caret', () => {
    const text = 'Photo of @ma';
    expect(mentionQuery(text, text.length)).toEqual({ query: 'ma', start: 9, end: 12 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0, end: 1 });
  });

  it('ignores e-mail addresses and finished words', () => {
    expect(mentionQuery('mail me@home', 12)).toBeNull();
    expect(mentionQuery('@max ', 5)).toBeNull();
  });
});

describe('mentionKeyAction', () => {
  it.each([
    [{ key: 'ArrowDown' }, 'next'],
    [{ key: 'ArrowUp' }, 'previous'],
    [{ key: 'Enter' }, 'pick'],
    [{ key: 'Tab' }, 'pick'],
    [{ key: 'Escape' }, 'close'],
    [{ key: 'Enter', metaKey: true }, null],
    [{ key: 'Enter', ctrlKey: true }, null],
    [{ key: 'a' }, null],
  ])('%j → %s', (e, action) => {
    expect(mentionKeyAction(e)).toBe(action);
  });
});
