// Text blocks for `darkroom models`, `darkroom favorites` and `darkroom voices <model>` (one block per model, kind
// or voice group). The model lists come ranked from the loaders (favorites, recommended, newest) and keep that order.

import { voiceGroups } from '@darkroom/core/audio/voice-lang';
import type { PrivacyMode } from '@darkroom/core/config';
import type {
  Favorites,
  ModelKind,
  ModelMarks,
  MusicModelInfo,
  ParamSpec,
  SpeechModel,
  SpeechModelInfo,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';
import { maxRefs } from '@darkroom/core/image/params';
import {
  imagePriceLabel,
  isNewModel,
  privacyAllows,
  releaseMonth,
  speechPriceLabel,
  zdrStatus,
} from '@darkroom/core/models/catalog';
import pc from 'picocolors';
import {
  type CatalogImageModel,
  FAVORITE_MARK,
  musicPrivacyNote,
  RECOMMENDED_MARK,
  takesInstructions,
} from './choices.ts';

export interface ListOptions {
  privacy: PrivacyMode;
  search?: string;
  /** Images: include models without reference images. */
  all?: boolean;
  /** All parameters and capabilities per model (otherwise two lines per model). */
  details?: boolean;
}

function matches(m: { id: string; name: string }, search: string | undefined): boolean {
  return !search || `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase());
}

/** The models a listing shows: those matching --search (the text listing and --json alike). */
export function listedModels<M extends { id: string; name: string }>(models: M[], o: ListOptions): M[] {
  return models.filter((m) => matches(m, o.search));
}

/** Image models a listing shows: with reference images (unless --all) and matching --search. */
export function listedImageModels(models: CatalogImageModel[], o: ListOptions): CatalogImageModel[] {
  return listedModels(models, o).filter((m) => o.all || (maxRefs(m) ?? 0) > 0);
}

/** ZDR status and whether the privacy mode lets the model run; `music` runs anyway (see musicPrivacyNote). */
function zdrSummary(zdr: ZdrEndpoint[], privacy: PrivacyMode, music = false): string {
  const status = zdrStatus(zdr);
  const note = music ? musicPrivacyNote(zdr, privacy) : null;
  let usable = pc.green(`usable with --privacy ${privacy}`);
  if (note) usable = pc.yellow(`${note} with --privacy ${privacy}`);
  else if (!privacyAllows(zdr, privacy)) usable = pc.red(`blocked with --privacy ${privacy}`);
  return `${pc.dim('ZDR')} ${status === 'no ZDR' ? pc.dim(status) : pc.green(status)}  ${usable}`;
}

/** The ZDR endpoints (details). */
function zdrEndpointsText(zdr: ZdrEndpoint[]): string {
  return zdr.length ? zdr.map((e) => `${e.tag}${e.safetyRetention ? ' (safety retention)' : ''}`).join(', ') : 'none';
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
export const LEGEND = `${FAVORITE_MARK} your favorites (first; darkroom favorites add|remove <model>)  ${RECOMMENDED_MARK} recommended  new: released in the last 30 days. Then newest first. --details lists all parameters.`;

/** A detail line: label column, then the value. */
const row = (label: string, value: string) => `${pc.dim(label.padEnd(14))}${value}`;

/** First sentence of a description, at most 120 characters. */
function about(description: string): string[] {
  const first = description.trim().split(/(?<=[.!?])\s/)[0] ?? '';
  if (!first) return [];
  return [row('about', first.length > 120 ? `${first.slice(0, 119)}…` : first)];
}

function paramValues(spec: ParamSpec | undefined, none: string): string {
  if (spec?.type === 'enum') return spec.values.join(' ');
  if (spec?.type === 'range') return `${spec.min}–${spec.max}`;
  return spec ? 'yes' : none;
}

/** Parameters shown in their own detail line; the others are listed under "other". */
const IMAGE_PARAMS: Record<string, string> = {
  resolution: 'sizes',
  aspect_ratio: 'aspect',
  output_format: 'formats',
  quality: 'quality',
};

function imageDetails(m: CatalogImageModel): string[] {
  const sp = m.supported_parameters;
  const n = sp.n?.type === 'range' ? `${Math.max(1, sp.n.min)}–${sp.n.max} per request` : '1 per request';
  const other = Object.keys(sp)
    .filter((k) => !(k in IMAGE_PARAMS) && k !== 'input_references' && k !== 'n')
    .map((k) => (sp[k].type === 'boolean' ? k : `${k} ${paramValues(sp[k], '')}`));
  return [
    ...Object.entries(IMAGE_PARAMS).map(([key, label]) => row(label, paramValues(sp[key], 'model default'))),
    row('references', `up to ${maxRefs(m) ?? 0}`),
    row('images', n),
    ...(other.length ? [row('other', other.join(', '))] : []),
    row('ZDR', zdrEndpointsText(m.zdr)),
    ...about(m.description ?? ''),
  ];
}

export function imageModelBlocks(models: CatalogImageModel[], o: ListOptions): string[] {
  return listedImageModels(models, o).map((m) =>
    [
      title(m),
      [
        `${pc.dim('price')} ${imagePriceLabel(m.price) ?? 'n/a'}`,
        `${pc.dim('refs')} ${maxRefs(m) ? `up to ${maxRefs(m)}` : 'none'}`,
        zdrSummary(m.zdr, o.privacy),
      ].join('  '),
      ...(o.details ? imageDetails(m) : []),
    ].join('\n'),
  );
}

/** Audio model blocks: title and name, the summary, the details when asked for. */
function audioBlocks<M extends MusicModelInfo>(
  models: M[],
  o: ListOptions,
  summary: (m: M) => string,
  details: (m: M) => string[],
): string[] {
  return listedModels(models, o).map((m) =>
    [
      `${title(m)}  ${pc.dim(m.name)}`,
      summary(m),
      ...(o.details ? [...details(m), row('ZDR', zdrEndpointsText(m.zdr)), ...about(m.description)] : []),
    ].join('\n'),
  );
}

/** Voices per language, e.g. "German 2, English 1". */
function languages(m: SpeechModel): string {
  return voiceGroups(m, [])
    .map((g) => `${g.label} ${g.voices.length}`)
    .join(', ');
}

export function speechModelBlocks(models: SpeechModelInfo[], o: ListOptions): string[] {
  return audioBlocks(
    models,
    o,
    (m) =>
      [
        `${pc.dim('price')} ${speechPriceLabel(m) ?? 'n/a'}`,
        `${pc.dim('voices')} ${m.voices.length || 'model default'}`,
        `${pc.dim('cloning')} ${m.cloning ? pc.green('yes (voice:<name>)') : 'no'}`,
        zdrSummary(m.zdr, o.privacy),
      ].join('  '),
    (m) => [
      row('voices', m.voices.length ? `${m.voices.length}: ${languages(m)}` : 'model default only'),
      row('cloning', m.cloning ? `yes${m.multiRef ? ', several reference clips' : ''}` : 'no'),
      row('instructions', takesInstructions(m.id) ? 'yes (-i)' : 'no'),
      row('speed', '0.25–4× (--speed; sent to the provider, not every model follows it)'),
    ],
  );
}

/** A 30 s clip or a full song, when the id or description tells. */
export function musicLength(m: MusicModelInfo): string | null {
  if (/clip/i.test(m.id)) return 'clip (about 30 s)';
  return /song|\bpro\b/i.test(`${m.id} ${m.description}`) ? 'full song' : null;
}

export function musicModelBlocks(models: MusicModelInfo[], o: ListOptions): string[] {
  return audioBlocks(
    models,
    o,
    (m) => zdrSummary(m.zdr, o.privacy, true),
    (m) => {
      const length = musicLength(m);
      return length ? [row('length', length)] : [];
    },
  );
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
