// JSON output (--json): one document on stdout per command, for scripts and AI agents. The shapes are documented
// in the skill guide (agent/skill.ts) and stay stable: fields may be added, never renamed or removed.
import path from 'node:path';
import { voiceGroups } from '@darkroom/core/audio/voice-lang';
import type {
  CostSummary,
  ElementInfo,
  Favorites,
  ManifestEntry,
  MessageParams,
  ModelKind,
  ModelMarks,
  MusicModelInfo,
  SpeechModel,
  SpeechModelInfo,
  VoiceInfo,
  ZdrEndpoint,
} from '@darkroom/core/contract';
import { maxRefs } from '@darkroom/core/image/params';
import { imagePriceLabel, isNewModel, privacyAllows, speechPriceLabel, zdrStatus } from '@darkroom/core/models/catalog';
import { CommanderError } from 'commander';
import { type CatalogImageModel, musicPrivacyNote, takesInstructions } from '../interactive/choices.ts';
import { type ListOptions, listedImageModels, listedModels, musicLength } from './listing.ts';

interface Writable {
  write(text: string): unknown;
  isTTY?: boolean;
}

/** Print the document: indented for a person at a terminal, one line for pipes. */
export function printJson(doc: unknown, stdout: Writable = process.stdout): void {
  stdout.write(`${JSON.stringify(doc, null, stdout.isTTY ? 2 : undefined)}\n`);
}

/** USD amounts without floating point noise (0.051000000000000004 → 0.051). */
function usd<T extends number | null>(v: T): T {
  return (v === null ? v : Math.round(v * 1e6) / 1e6) as T;
}

// ---------------------------------------------------------------- Errors

interface ErrorInfo {
  /** Machine-readable code: darkroom's own codes (e.g. api_key_missing, unknown_model), commander's for invalid
   *  arguments (e.g. commander.invalidArgument), null for errors from upstream. */
  code: string | null;
  message: string;
  params: MessageParams;
}

/** A command that failed as a whole. */
export function failureDocument(err: unknown): { ok: false; error: ErrorInfo } {
  const e = err as { code?: unknown; params?: MessageParams; message?: string };
  const message = String(e?.message ?? err).replace(/^error: /, '');
  const code = typeof e?.code === 'string' ? e.code : null;
  return { ok: false, error: { code, message, params: err instanceof CommanderError ? {} : (e?.params ?? {}) } };
}

// ---------------------------------------------------------------- Runs

export type RunKind = ModelKind;

interface WarningInfo {
  code: string | null;
  params: MessageParams;
  message: string;
}

/** The English warnings with their codes (notices[i] belongs to warnings[i]). */
function warningsOf(e: ManifestEntry): WarningInfo[] {
  return e.warnings.map((message, i) => {
    const notice = e.notices?.[i];
    return { code: notice?.code ?? null, params: notice?.params ?? {}, message };
  });
}

/**
 * Result of gen, speak and music. `ok` is true when at least one result was made (exit code 0, also for a partial
 * success); failed models are in `errors`. Costs in USD; failed calls can be charged too.
 */
export function runDocument(kind: RunKind, entries: ManifestEntry[], costs: CostSummary, outDir: string) {
  const done = entries.filter((e) => e.ok && e.file);
  return {
    ok: done.length > 0,
    results: done.map((e) => ({
      file: path.join(outDir, e.file as string),
      kind,
      model: e.model,
      ...(e.voice ? { voice: e.voice } : {}),
      cost: usd(e.cost),
      durationMs: e.durationMs,
      warnings: warningsOf(e),
    })),
    errors: entries
      .filter((e) => !done.includes(e))
      .map((e) => ({
        model: e.model,
        code: e.errorCode ?? null,
        message: e.error ?? 'Failed',
        params: e.errorParams ?? {},
      })),
    cost: { run: usd(entries.reduce((s, e) => s + (e.cost ?? 0), 0)), totalSoFar: usd(costs.total) },
  };
}

// ---------------------------------------------------------------- Model listings

/** Release date as YYYY-MM-DD (null without one). */
function isoDate(created: number | undefined): string | null {
  return created === undefined ? null : new Date(created * 1000).toISOString().slice(0, 10);
}

/** What every model listing says about a model; `usable` is whether the privacy mode lets it run. */
function modelBase(m: { id: string; name: string; created?: number; zdr: ZdrEndpoint[] } & ModelMarks, o: ListOptions) {
  return {
    id: m.id,
    name: m.name,
    released: isoDate(m.created),
    new: isNewModel(m.created),
    favorite: m.favorite,
    recommended: m.recommended,
    zdr: zdrStatus(m.zdr),
    usable: privacyAllows(m.zdr, o.privacy),
  };
}

/** --details: the ZDR endpoints and the description. */
function detailsBase(m: { zdr: ZdrEndpoint[]; description?: string }) {
  return {
    zdrEndpoints: m.zdr.map((e) => ({ provider: e.provider, tag: e.tag, safetyRetention: e.safetyRetention })),
    description: m.description ?? '',
  };
}

export function imageModelsDocument(models: CatalogImageModel[], o: ListOptions) {
  return listedImageModels(models, o).map((m) => ({
    ...modelBase(m, o),
    price: imagePriceLabel(m.price),
    maxRefs: maxRefs(m) ?? 0,
    ...(o.details ? { parameters: m.supported_parameters, ...detailsBase(m) } : {}),
  }));
}

/** A speech model's preset voices with their language. */
function voiceList(m: SpeechModel) {
  return voiceGroups(m, []).flatMap((g) => g.voices.map((v) => ({ voice: v.value, language: g.label })));
}

export function speechModelsDocument(models: SpeechModelInfo[], o: ListOptions) {
  return listedModels(models, o).map((m) => ({
    ...modelBase(m, o),
    price: speechPriceLabel(m),
    voiceCount: m.voices.length,
    cloning: m.cloning,
    ...(o.details
      ? {
          voices: voiceList(m),
          multiRef: m.multiRef,
          instructions: takesInstructions(m.id),
          ...detailsBase(m),
        }
      : {}),
  }));
}

/** Music is never blocked: `privacyNote` says how it runs when the mode has no matching ZDR endpoint. */
export function musicModelsDocument(models: MusicModelInfo[], o: ListOptions) {
  return listedModels(models, o).map((m) => ({
    ...modelBase(m, o),
    usable: true,
    privacyNote: musicPrivacyNote(m.zdr, o.privacy),
    ...(o.details ? { length: musicLength(m), ...detailsBase(m) } : {}),
  }));
}

// ---------------------------------------------------------------- Library

/** Own voices (voices without a model). */
export function ownVoicesDocument(voices: VoiceInfo[]) {
  return voices.map((v) => ({ voice: `voice:${v.name}`, name: v.name, label: v.label, samples: v.samples.length }));
}

/** A speech model's voices by language, own voices first when the model clones. */
export function modelVoicesDocument(model: SpeechModel, own: VoiceInfo[]) {
  return voiceGroups(model, own).flatMap((g) =>
    g.voices.map((v) => ({
      voice: v.value,
      label: v.label,
      language: g.code === 'own' ? null : g.label,
      own: g.code === 'own',
    })),
  );
}

export function elementsDocument(elements: ElementInfo[]) {
  return elements.map((e) => ({
    name: e.name,
    mention: `@${e.name}`,
    label: e.label,
    type: e.type,
    instructions: e.instructions,
    images: e.photos.length,
  }));
}

export function favoritesDocument(favorites: Favorites, kinds: readonly ModelKind[]) {
  return kinds.flatMap((kind) => favorites[kind].map((model) => ({ kind, model })));
}

/** Costs in USD per model (most expensive first) and in total (failed calls included); `results` counts results. */
export function costsDocument(s: CostSummary) {
  return {
    total: usd(s.total),
    results: s.images,
    models: Object.entries(s.byModel)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, v]) => ({ model, cost: usd(v.cost), results: v.images })),
  };
}
