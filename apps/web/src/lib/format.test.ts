import { afterEach, describe, expect, it } from 'vitest';
import { fmtTime, money, num, setFormatLang, usd } from './format';

// Intl puts a (narrow) no-break space between number and currency sign in German
const plain = (s: string) => s.replace(/[  ]/g, ' ');

afterEach(() => setFormatLang('en'));

describe('usd', () => {
  it('formats costs in English and German', () => {
    expect(usd(null)).toBe('n/a');
    expect(usd(undefined, 'de')).toBe('n/a');
    expect(usd(0.0391, 'en')).toBe('$0.0391');
    expect(usd(0.095, 'en')).toBe('$0.0950');
    expect(usd(1.5, 'en')).toBe('$1.500');
    expect(plain(usd(0.095, 'de'))).toBe('0,0950 $');
    expect(plain(usd(1234.5, 'de'))).toBe('1.234,500 $');
  });

  it('follows the UI language', () => {
    expect(usd(0.04)).toBe('$0.0400');
    setFormatLang('de');
    expect(plain(usd(0.04))).toBe('0,0400 $');
  });
});

describe('money and num', () => {
  it('formats with the given fraction digits', () => {
    expect(money(0.04, 2, 6, 'en')).toBe('$0.04');
    expect(money(0.000015, 2, 6, 'en')).toBe('$0.000015');
    expect(plain(money(0.015, 3, 3, 'de'))).toBe('0,015 $');
    expect(num(0, 1, 'en')).toBe('0.0');
    expect(num(2.25, 1, 'de')).toBe('2,3');
    expect(num(1234, 0, 'de')).toBe('1.234');
    expect(num(12.6, 0, 'en')).toBe('13');
  });
});

describe('fmtTime', () => {
  it('formats player times', () => {
    expect(fmtTime(75.9)).toBe('1:15');
    expect(fmtTime(Number.NaN)).toBe('0:00');
    expect(fmtTime(-1)).toBe('0:00');
  });
});
