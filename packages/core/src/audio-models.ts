// Speech and music model catalogs (OpenRouter /models with output modalities).
import type { MusicModel, SpeechModel } from './contract.ts';
import { zdrEndpoints } from './openrouter.ts';
import { getJson } from './upstream.ts';

export type { MusicModel, SpeechModel };

interface RawModel {
  id: string;
  name: string;
  description?: string;
  pricing?: Record<string, string>;
  supported_voices?: unknown;
}

interface RawEndpoint {
  supports_voice_cloning?: boolean;
  supports_multiple_audio_references?: boolean;
}

const HOUR = 3_600_000;
let speechCache: { at: number; models: SpeechModel[] } | null = null;
let musicCache: { at: number; models: MusicModel[] } | null = null;

async function endpointsOf(id: string): Promise<RawEndpoint[]> {
  try {
    return (await getJson<{ data?: { endpoints?: RawEndpoint[] } }>(`/models/${id}/endpoints`)).data?.endpoints ?? [];
  } catch {
    return []; // continue without capability flags
  }
}

/** Speech models incl. voices, voice cloning capability (from the endpoints) and ZDR status. */
export async function listSpeechModels(force = false): Promise<SpeechModel[]> {
  if (!force && speechCache && Date.now() - speechCache.at < HOUR) return speechCache.models;
  const [body, zdr] = await Promise.all([
    getJson<{ data?: RawModel[] }>('/models?output_modalities=speech'),
    zdrEndpoints(),
  ]);
  const queue = [...(body.data ?? [])];
  const models: SpeechModel[] = [];
  // 8 endpoint requests at a time
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const eps = await endpointsOf(m.id);
      models.push({
        id: m.id,
        name: m.name,
        description: m.description ?? '',
        pricing: m.pricing ?? {},
        voices: Array.isArray(m.supported_voices) ? m.supported_voices.map(String) : [],
        cloning: eps.some((e) => e.supports_voice_cloning),
        multiRef: eps.some((e) => e.supports_multiple_audio_references),
        zdr: zdr.get(m.id) ?? [],
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  models.sort((a, b) => a.name.localeCompare(b.name));
  speechCache = { at: Date.now(), models };
  return models;
}

/** Music models (Lyria and similar); chat models with audio output are left out. */
export async function listMusicModels(force = false): Promise<MusicModel[]> {
  if (!force && musicCache && Date.now() - musicCache.at < HOUR) return musicCache.models;
  const [body, zdr] = await Promise.all([
    getJson<{ data?: RawModel[] }>('/models?output_modalities=audio'),
    zdrEndpoints(),
  ]);
  const models: MusicModel[] = (body.data ?? [])
    .filter((m) => /lyria|music|song/i.test(`${m.id} ${m.description ?? ''}`) && !/^openai\/gpt-audio/.test(m.id))
    .map((m) => ({ id: m.id, name: m.name, description: m.description ?? '', zdr: zdr.get(m.id) ?? [] }));
  musicCache = { at: Date.now(), models };
  return models;
}
