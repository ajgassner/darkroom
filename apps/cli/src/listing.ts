// Text blocks for `darkroom models` and `darkroom voices <model>` (one block per model or voice group).
import {
  byRecommendation,
  imagePriceLabel,
  privacyAllows,
  RECOMMENDED_IMAGE,
  RECOMMENDED_SPEECH,
  speechPriceLabel,
} from '@darkroom/core/catalog';
import type { PrivacyMode } from '@darkroom/core/config';
import type { MusicModel, SpeechModel, VoiceInfo, ZdrEndpoint } from '@darkroom/core/contract';
import { maxRefs } from '@darkroom/core/params';
import { voiceGroups } from '@darkroom/core/voice-lang';
import pc from 'picocolors';
import type { CatalogImageModel } from './choices.ts';

export const MODEL_KINDS = ['image', 'speech', 'music'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

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

const title = (id: string, recommended: string[]) =>
  `${pc.bold(id)}${recommended.includes(id) ? pc.yellow('  ★ recommended') : ''}`;

function paramValues(m: CatalogImageModel, key: string): string {
  const s = m.supported_parameters[key];
  if (s?.type === 'enum') return s.values.join(' ');
  if (s?.type === 'range') return `${s.min}–${s.max}`;
  return s ? 'yes' : '–';
}

export function imageModelBlocks(models: CatalogImageModel[], o: ListOptions): string[] {
  const rows = models.filter((m) => (o.all || (maxRefs(m) ?? 0) > 0) && matches(m, o.search));
  return byRecommendation(rows, RECOMMENDED_IMAGE).map((m) => {
    const v = (key: string) => paramValues(m, key);
    return [
      title(m.id, RECOMMENDED_IMAGE),
      `${pc.dim('price')} ${imagePriceLabel(m.price) ?? 'n/a'}  ${pc.dim('refs')} ${v('input_references')}  ${pc.dim('n')} ${v('n')}`,
      `${pc.dim('size')} ${v('resolution')}  ${pc.dim('format')} ${v('output_format')}  ${pc.dim('quality')} ${v('quality')}`,
      `${pc.dim('aspect')} ${v('aspect_ratio')}`,
      zdrLine(m.zdr, o.privacy),
    ].join('\n');
  });
}

export function speechModelBlocks(models: SpeechModel[], o: ListOptions): string[] {
  const rows = models.filter((m) => matches(m, o.search));
  return byRecommendation(rows, RECOMMENDED_SPEECH).map((m) =>
    [
      `${title(m.id, RECOMMENDED_SPEECH)}  ${pc.dim(m.name)}`,
      [
        `${pc.dim('price')} ${speechPriceLabel(m) ?? 'n/a'}`,
        `${pc.dim('voices')} ${m.voices.length || 'model default'}`,
        `${pc.dim('cloning')} ${m.cloning ? pc.green('yes (voice:<name>)') : 'no'}`,
      ].join('  '),
      zdrLine(m.zdr, o.privacy),
    ].join('\n'),
  );
}

export function musicModelBlocks(models: MusicModel[], o: ListOptions): string[] {
  return models
    .filter((m) => matches(m, o.search))
    .map((m) => [`${pc.bold(m.id)}  ${pc.dim(m.name)}`, zdrLine(m.zdr, o.privacy)].join('\n'));
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
