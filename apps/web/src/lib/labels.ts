// Display texts built from results and settings. Pure: the caller passes the translate function.
import type { TFunction } from 'i18next';
import { allowedByPrivacy, shortName } from './models';
import { estimateRun, usd } from './pricing';
import type { Settings } from './store';
import type { CostSummary, DebugRecord, ImageModel, ManifestEntry, VoiceInfo } from './types';

/** "@anna, @logo" */
function mentionList(names: string[]): string {
  return names.map((n) => `@${n}`).join(', ');
}

/** Elements of an entry; old entries only have the single `element`. */
export function entryElements(e: Pick<ManifestEntry, 'element' | 'elements'>): string[] {
  if (e.elements?.length) return e.elements;
  return e.element ? [e.element] : [];
}

/** Pseudo models of local results. */
const LOCAL_MODELS = {
  'local/sharp': 'gallery.local',
  'local/background-removal': 'gallery.localCutout',
  'local/upload': 'gallery.ownImage',
} as const;

/** Display name of any model ID (image, speech, music, local tools), searched in the given catalogs. */
export function modelName(t: TFunction, id: string, catalogs: { id: string; name: string }[][]): string {
  if (id in LOCAL_MODELS) return t(LOCAL_MODELS[id as keyof typeof LOCAL_MODELS]);
  for (const list of catalogs) {
    const m = list.find((x) => x.id === id);
    if (m) return shortName(m.name);
  }
  return id;
}

/** Voice as shown in the gallery: own voices by their label, model voices without the provider suffix. */
export function voiceLabel(t: TFunction, voices: VoiceInfo[], voice?: string): string {
  if (!voice) return t('gallery.defaultVoice');
  if (voice.startsWith('voice:')) {
    const name = voice.slice(6);
    return t('gallery.ownVoiceLabel', { label: voices.find((x) => x.name === name)?.label ?? name });
  }
  return voice.replace(/:MAI-Voice.*$/, '');
}

// ---------------------------------------------------------------- Gallery card

type RunFirst = Partial<ManifestEntry>;
type MetaPart = string | null | undefined;

/** What a run was made with, before time and models (empty parts are skipped by the caller). */
export function runMetaParts(t: TFunction, first: RunFirst, voice: (v?: string) => string): MetaPart[] {
  const p = (first.params ?? {}) as Record<string, string | undefined>;
  if (first.kind === 'audio') {
    return [
      p.mode === 'music' ? t('gallery.music') : t('gallery.speechMeta', { voice: voice(first.voice) }),
      p.instructions,
    ];
  }
  if (first.tool) {
    return [toolLabel(t, first), first.element ? t('gallery.element', { name: first.element }) : null];
  }
  return [
    elementsLabel(t, first),
    p.aspect_ratio,
    p.resolution,
    p.quality,
    first.extraRefs?.length ? `+${first.extraRefs.length} Ref` : null,
  ];
}

function toolLabel(t: TFunction, first: RunFirst): string {
  if (first.tool === 'import') return t('gallery.ownImage');
  return first.source ? t('gallery.toolOn', { file: first.source }) : t('gallery.tool');
}

function elementsLabel(t: TFunction, first: RunFirst): string {
  if (first.elements?.length) return t('gallery.elements', { list: mentionList(first.elements) });
  return first.element ? t('gallery.element', { name: first.element }) : t('gallery.noElement');
}

// ---------------------------------------------------------------- Composer

export interface SummaryInput {
  settings: Pick<Settings, 'mode' | 'models' | 'privacy' | 'count' | 'size' | 'quality' | 'audioKind'>;
  models: ImageModel[];
  costs: CostSummary | undefined;
  promptLength: number;
  running: number;
}

/** One-line summary next to the generate button: what will be generated, estimated cost, runs in progress. */
export function composerSummary(t: TFunction, input: SummaryInput): string {
  const { settings: s } = input;
  const parts =
    s.mode === 'image'
      ? imageSummary(t, input)
      : [s.audioKind === 'speech' ? t('composer.chars', { count: input.promptLength }) : t('composer.musicClip')];
  if (input.running) parts.push(t('composer.running', { count: input.running }));
  return parts.join(' · ');
}

function imageSummary(t: TFunction, { settings: s, models, costs }: SummaryInput): string[] {
  const sel = models.filter((m) => s.models.includes(m.id) && allowedByPrivacy(m.zdr, s.privacy));
  if (!sel.length) return [];
  const parts: string[] = [
    t('composer.images', { count: sel.length * s.count }),
    t('composer.models', { count: sel.length }),
  ];
  const est = estimateRun(sel, s.count, s.size, s.quality, costs);
  if (est.total) {
    parts.push(t('composer.estimate', { cost: usd(est.total) }) + (est.unknown ? t('composer.estimateUnknown') : ''));
  } else if (est.unknown) {
    parts.push(t('composer.costUnknown'));
  }
  return parts;
}

// ---------------------------------------------------------------- Lightbox and debug details

type Row = [label: string, value: string];

/** Detail rows of a result in the lightbox. */
export function entryInfoRows(t: TFunction, e: ManifestEntry, modelName: (id: string) => string): Row[] {
  const none = t('common.none');
  return [
    [t('lightbox.model'), modelName(e.model)],
    [t('lightbox.provider'), e.provider || none],
    [t('lightbox.cost'), costText(t, e)],
    [t('lightbox.duration'), t('lightbox.seconds', { value: (e.durationMs / 1000).toFixed(1) })],
    [t('lightbox.elements'), mentionList(entryElements(e)) || none],
    [t('lightbox.references'), String(e.refCount)],
    [
      t('lightbox.params'),
      Object.entries(e.params ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    ],
    [t('lightbox.privacy'), privacyText(e)],
    [t('lightbox.file'), e.file ?? ''],
    [t('lightbox.generationId'), e.generationId || none],
  ];
}

/** Cost per image, plus the cost of the whole call if it produced several images. */
function costText(t: TFunction, e: ManifestEntry): string {
  const call =
    e.callCost !== null && e.callCost !== e.cost ? ` ${t('lightbox.callCost', { cost: usd(e.callCost) })}` : '';
  return `${usd(e.cost)}${call}`;
}

function privacyText(e: ManifestEntry): string {
  return e.providerRestriction ? `${e.privacy} → ${e.providerRestriction.join(', ')}` : e.privacy;
}

/** Summary rows of a recorded API call; provider and generation id fall back to the response headers. */
export function debugRows(t: TFunction, e: ManifestEntry, d: DebugRecord): Row[] {
  const none = t('common.none');
  const headers = d.responseHeaders;
  return [
    [t('debug.endpoint'), `${d.method} ${d.endpoint}`],
    [t('debug.status'), d.status === null ? t('debug.noResponse') : String(d.status)],
    [t('debug.duration'), `${(d.durationMs / 1000).toFixed(1)} s`],
    [t('debug.model'), e.model],
    [t('debug.provider'), e.provider || headers?.['x-openrouter-provider'] || none],
    [t('debug.generationId'), e.generationId || headers?.['x-generation-id'] || none],
    [t('debug.cost'), usd(e.cost)],
    [t('debug.elements'), mentionList(entryElements(e)) || none],
    [t('debug.refsSent'), String(d.sentFiles.length)],
  ];
}
