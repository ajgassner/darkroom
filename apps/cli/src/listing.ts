// Text blocks for `darkroom models`, `darkroom favorites` and `darkroom voices <model>` (one block per model, kind
// or voice group). The model lists come ranked from the loaders (favorites, recommended, newest) and keep that order.
import { imagePriceLabel, isNewModel, privacyAllows, releaseMonth, speechPriceLabel } from '@darkroom/core/catalog';
import type { PrivacyMode } from '@darkroom/core/config';
import type {
  Favorites,
  ModelKind,
  ModelMarks,
  MusicModelInfo,
  SpeechModel,
  SpeechModelInfo,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';
import { maxRefs } from '@darkroom/core/params';
import { voiceGroups } from '@darkroom/core/voice-lang';
import pc from 'picocolors';
import { type CatalogImageModel, FAVORITE_MARK, RECOMMENDED_MARK } from './choices.ts';

export interface ListOptions {
  privacy: PrivacyMode;
  search?: string;
  /** Images: include models without reference images. */
  all?: boolean;
}

function matches(m: { id: string; name: string }, search: string | undefined): boolean {
  return !search || `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase());
}

/** ZDR endpoints and whether the privacy mode lets the model run. */
function zdrLine(zdr: ZdrEndpoint[], privacy: PrivacyMode): string {
  const endpoints = zdr.length
    ? pc.green(zdr.map((e) => `${e.tag}${e.safetyRetention ? ' (safety retention)' : ''}`).join(', '))
    : pc.dim('no ZDR');
  const usable = privacyAllows(zdr, privacy)
    ? pc.green(`usable with --privacy ${privacy}`)
    : pc.red(`blocked with --privacy ${privacy}`);
  return `${pc.dim('ZDR')} ${endpoints}  ${usable}`;
}

/** Model id with its marks, release month and "new" (released in the last 30 days). */
function title(m: { id: string; created?: number } & ModelMarks): string {
  const month = releaseMonth(m.created);
  return [
    pc.bold(m.id),
    m.favorite && pc.magenta(`${FAVORITE_MARK} favorite`),
    m.recommended && pc.yellow(`${RECOMMENDED_MARK} recommended`),
    month && pc.dim(month),
    isNewModel(m.created) && pc.green('new'),
  ]
    .filter(Boolean)
    .join('  ');
}

/** What the marks in the model listings mean. */
export const LEGEND = `${FAVORITE_MARK} your favorites (first; darkroom favorites add|remove <model>)  ${RECOMMENDED_MARK} recommended  new: released in the last 30 days. Then newest first.`;

function paramValues(m: CatalogImageModel, key: string): string {
  const s = m.supported_parameters[key];
  if (s?.type === 'enum') return s.values.join(' ');
  if (s?.type === 'range') return `${s.min}–${s.max}`;
  return s ? 'yes' : '–';
}

export function imageModelBlocks(models: CatalogImageModel[], o: ListOptions): string[] {
  const rows = models.filter((m) => (o.all || (maxRefs(m) ?? 0) > 0) && matches(m, o.search));
  return rows.map((m) => {
    const v = (key: string) => paramValues(m, key);
    return [
      title(m),
      `${pc.dim('price')} ${imagePriceLabel(m.price) ?? 'n/a'}  ${pc.dim('refs')} ${v('input_references')}  ${pc.dim('n')} ${v('n')}`,
      `${pc.dim('size')} ${v('resolution')}  ${pc.dim('format')} ${v('output_format')}  ${pc.dim('quality')} ${v('quality')}`,
      `${pc.dim('aspect')} ${v('aspect_ratio')}`,
      zdrLine(m.zdr, o.privacy),
    ].join('\n');
  });
}

/** Audio model blocks: title and name, the given detail lines, the ZDR line. */
function audioBlocks<M extends MusicModelInfo>(models: M[], o: ListOptions, details: (m: M) => string[]): string[] {
  return models
    .filter((m) => matches(m, o.search))
    .map((m) => [`${title(m)}  ${pc.dim(m.name)}`, ...details(m), zdrLine(m.zdr, o.privacy)].join('\n'));
}

export function speechModelBlocks(models: SpeechModelInfo[], o: ListOptions): string[] {
  return audioBlocks(models, o, (m) => [
    [
      `${pc.dim('price')} ${speechPriceLabel(m) ?? 'n/a'}`,
      `${pc.dim('voices')} ${m.voices.length || 'model default'}`,
      `${pc.dim('cloning')} ${m.cloning ? pc.green('yes (voice:<name>)') : 'no'}`,
    ].join('  '),
  ]);
}

export function musicModelBlocks(models: MusicModelInfo[], o: ListOptions): string[] {
  return audioBlocks(models, o, () => []);
}

/** The favorites of each kind (or of one kind). */
export function favoriteBlocks(favorites: Favorites, kinds: readonly ModelKind[]): string[] {
  return kinds.map(
    (k) =>
      `${pc.bold(`${k} favorites`)} ${pc.dim(`(${favorites[k].length})`)}\n${favorites[k].join('\n') || pc.dim('none')}`,
  );
}

/** A speech model's voices grouped by language, plus the own voices (usable when the model can clone). */
export function voiceBlocks(model: SpeechModel, ownVoices: VoiceInfo[]): string[] {
  const groups = voiceGroups(model, ownVoices).map(
    (g) =>
      `${pc.bold(g.label)} ${pc.dim(`(${g.voices.length})`)}\n${g.voices.map((v) => (v.value.startsWith('voice:') ? `${v.value} ${pc.dim(v.label)}` : v.value)).join(', ')}`,
  );
  if (!model.voices.length) groups.push(pc.dim('No preset voices: the model speaks with its default voice.'));
  if (ownVoices.length && !model.cloning) {
    groups.push(pc.dim(`Own voices (${ownVoices.map((v) => `voice:${v.name}`).join(', ')}) need a model that clones.`));
  }
  return groups;
}
