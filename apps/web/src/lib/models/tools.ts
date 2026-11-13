// Translated titles of tool results and relight presets. The server stores English labels as the prompt; the UI
// builds its own from `tool` + `toolOptions` and falls back to the stored prompt for unknown tools or old entries.
import type { TFunction } from 'i18next';
import type { ManifestEntry } from '../types';

/** Relight presets with a translation (tools.preset.*); others keep the server's English label. */
const RELIGHT_PRESETS = ['golden', 'studio', 'window', 'dramatic', 'overcast', 'blue', 'night'] as const;
type RelightPreset = (typeof RELIGHT_PRESETS)[number];

const isPreset = (key: string): key is RelightPreset => (RELIGHT_PRESETS as readonly string[]).includes(key);

/** Name of a relight preset; unknown keys fall back to the given label (or the key itself). */
export function relightName(t: TFunction, key: string, fallback?: string): string {
  return isPreset(key) ? t(`tools.preset.${key}`) : (fallback ?? key);
}

/** Options for the relight preset select: [key, translated name]. */
export function relightOptions(t: TFunction, server: Record<string, string> | undefined): [string, string][] {
  return Object.entries(server ?? { golden: 'Golden hour' }).map(([key, label]) => [key, relightName(t, key, label)]);
}

type Options = Record<string, string>;
type Params = Record<string, unknown>;
/** Title of one tool from its options and result parameters; null if the options don't suffice. */
type TitleFn = (t: TFunction, o: Options, p: Params) => string | null;

function cropTitle(t: TFunction, o: Options, p: Params): string | null {
  if (!o.aspect) return null;
  if (p.width && p.height) {
    return t('toolTitle.cropSize', { aspect: o.aspect, width: String(p.width), height: String(p.height) });
  }
  return t('toolTitle.crop', { aspect: o.aspect });
}

function resizeTitle(t: TFunction, o: Options, p: Params): string | null {
  if (p.width && p.height) return t('toolTitle.resize', { width: String(p.width), height: String(p.height) });
  if (o.width) return t('toolTitle.resizeWidth', { width: o.width });
  return o.factor ? t('toolTitle.resizeFactor', { factor: o.factor }) : null;
}

function removebgTitle(t: TFunction, o: Options): string | null {
  if (!o.background) return null;
  if (o.background === 'transparent') return t('toolTitle.removebg');
  return t('toolTitle.removebgColor', { color: o.background });
}

function relightTitle(t: TFunction, o: Options): string | null {
  const custom = o.custom?.trim();
  if (custom) return t('toolTitle.relight', { light: custom });
  return o.preset && isPreset(o.preset) ? t('toolTitle.relight', { light: relightName(t, o.preset) }) : null;
}

const TITLES: Record<string, TitleFn> = {
  import: (t, o) => (o.filename ? t('toolTitle.import', { name: o.filename }) : null),
  crop: cropTitle,
  resize: resizeTitle,
  removebg: removebgTitle,
  expand: (t, o) => (o.aspect ? t('toolTitle.expand', { aspect: o.aspect }) : null),
  upscale: (t, o) => (o.resolution ? t('toolTitle.upscale', { resolution: o.resolution }) : null),
  relight: relightTitle,
  cleanup: (t) => t('toolTitle.cleanup'),
};

type TitleEntry = Partial<Pick<ManifestEntry, 'tool' | 'toolOptions' | 'params' | 'prompt'>>;

/** Title of a result: translated for tool results, otherwise (and for unknown tools/old entries) the prompt. */
export function entryTitle(t: TFunction, e: TitleEntry): string {
  const title = e.tool && e.toolOptions ? TITLES[e.tool]?.(t, e.toolOptions, e.params ?? {}) : null;
  return title || e.prompt || '';
}
