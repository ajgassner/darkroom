// Settings to restore when an earlier result is reused ("reuse settings" in the gallery and lightbox).
import type { Settings } from './store';
import type { ManifestEntry } from './types';

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

/** Image settings of an image result; its model is added only if it isn't selected already. */
export function imageSettingsFrom(
  e: Entry & Pick<ManifestEntry, 'element' | 'usePrefix'>,
  current: Pick<Settings, 'aspect' | 'models'>,
): Partial<Settings> {
  const p = e.params ?? {};
  return {
    mode: 'image',
    element: e.element ?? '',
    usePrefix: e.usePrefix !== false,
    aspect: String(p.aspect_ratio ?? current.aspect),
    size: String(p.resolution ?? ''),
    quality: String(p.quality ?? ''),
    format: String(p.output_format ?? ''),
    count: Number(p.count ?? 1),
    models: current.models.includes(e.model) ? current.models : [e.model],
  };
}

/** The result's extra references, as references to files in the output folder. */
export function extraRefsFrom(e: Pick<ManifestEntry, 'extraRefs'>): { kind: 'out'; outFile: string }[] {
  return (e.extraRefs ?? []).map((f) => ({ kind: 'out', outFile: f }));
}
