// Numbers, prices and durations formatted for the UI language. i18n sets the language (setFormatLang) before the
// components re-render after a language switch; tests pass the language explicitly.

let uiLang = 'en';

export function setFormatLang(lang: string) {
  uiLang = lang;
}

const cache = new Map<string, Intl.NumberFormat>();

function formatter(lang: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang, options);
    cache.set(key, f);
  }
  return f;
}

/** Amount in US dollars with a fixed number of fraction digits (or a range), e.g. "$0.0950" / "0,0950 $". */
export function money(v: number, minDigits: number, maxDigits = minDigits, lang = uiLang): string {
  return formatter(lang, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(v);
}

/** Cost of a result or run: 4 decimals below 10 cents, otherwise 3. */
export function usd(v: number | null | undefined, lang = uiLang): string {
  if (v === null || v === undefined) return 'n/a';
  return money(v, v < 0.1 ? 4 : 3, undefined, lang);
}

/** Plain number with a fixed number of fraction digits, e.g. seconds: "0.5" / "0,5". */
export function num(v: number, digits = 0, lang = uiLang): string {
  return formatter(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** Player time "m:ss". */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
