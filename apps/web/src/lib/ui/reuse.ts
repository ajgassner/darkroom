// Settings to restore when an earlier result is reused ("reuse settings" in the gallery and lightbox).
import type { Settings } from '../store';
import type { ManifestEntry } from '../types';

type Entry = Pick<ManifestEntry, 'model' | 'params' | 'voice'>;

/** Speech or music settings of an audio result. */
export function audioSettingsFrom(e: Entry): Partial<Settings> {
  const p = e.params ?? {};
  if (p.mode === 'music') return { mode: 'audio', audioKind: 'music', musicModel: e.model };
  return {
    mode: 'audio',
    audioKind: 'speech',
    speechModel: e.model,
    voice: e.voice ?? '',
    instructions: String(p.instructions ?? ''),
    speed: Number(p.speed ?? 1),
  };
}

type ImageEntry = Entry & Pick<ManifestEntry, 'element' | 'usePrefix' | 'notices'>;

/** Notices that mean a parameter was changed for this model (its params then differ from the requested ones). */
const ADJUSTED = new Set(['aspect_adjusted', 'size_adjusted']);

/** How well an entry's params reflect what the run asked for: params present minus params adjusted. */
function paramScore(e: ImageEntry): number {
  const p = e.params ?? {};
  const present = Number(p.aspect_ratio !== undefined) + Number(p.resolution !== undefined);
  return present - (e.notices ?? []).filter((n) => ADJUSTED.has(n.code)).length;
}

/**
 * Image settings of an image run (or a single result): params come from the entry that kept the requested aspect
 * ratio and size best, models are the run's models. The current selection is kept if it contains all of them.
 */
export function imageSettingsFrom(
  entries: ImageEntry[],
  current: Pick<Settings, 'aspect' | 'models'>,
): Partial<Settings> {
  const e = entries.reduce((best, x) => (paramScore(x) > paramScore(best) ? x : best));
  const p = e.params ?? {};
  const models = [...new Set(entries.map((x) => x.model))];
  return {
    mode: 'image',
    element: e.element ?? '',
    usePrefix: e.usePrefix !== false,
    aspect: String(p.aspect_ratio ?? current.aspect),
    size: String(p.resolution ?? ''),
    quality: String(p.quality ?? ''),
    format: String(p.output_format ?? ''),
    count: Number(p.count ?? 1),
    models: models.every((m) => current.models.includes(m)) ? current.models : models,
  };
}

/** The result's extra references, as references to files in the output folder. */
export function extraRefsFrom(e: Pick<ManifestEntry, 'extraRefs'>): { kind: 'out'; outFile: string }[] {
  return (e.extraRefs ?? []).map((f) => ({ kind: 'out', outFile: f }));
}
