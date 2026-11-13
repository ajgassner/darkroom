// Favorite models (favorites.json in the data folder), shared by the web UI and the CLI: they come first in every
// model list. Ids of models that left the catalog stay in the file and simply match nothing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { FAVORITES_FILE } from '../config.ts';
import type { Favorites, ModelKind } from '../contract.ts';
import { AppError, unknownModel } from '../errors.ts';
import { listMusicModels, listSpeechModels } from '../openrouter/audio-models.ts';
import { listImageModels } from '../openrouter/openrouter.ts';
import { readJsonObject, serialized, writeJsonAtomic } from '../storage/json-file.ts';

export const MODEL_KINDS = ['image', 'speech', 'music'] as const satisfies readonly ModelKind[];

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function normalize(raw: Partial<Record<string, unknown>>): Favorites {
  return { image: ids(raw.image), speech: ids(raw.speech), music: ids(raw.music) };
}

/** The favorites (empty lists without a file; a damaged file reads as no favorites). */
export async function readFavorites(): Promise<Favorites> {
  return normalize(await readJsonObject(FAVORITES_FILE));
}

const damaged = () =>
  new AppError('favorites_invalid', 'favorites.json is damaged and was left unchanged. Fix or delete it.');

/** Add or remove one favorite (one read-modify-write at a time; a damaged file is refused, not overwritten). */
export function setFavorite(kind: ModelKind, model: string, on: boolean): Promise<Favorites> {
  return serialized('favorites', async () => {
    const raw = await readJsonObject<Record<string, unknown>>(FAVORITES_FILE, damaged);
    const current = normalize(raw);
    const rest = current[kind].filter((id) => id !== model);
    const next = { ...current, [kind]: on ? [...rest, model] : rest };
    await fs.mkdir(path.dirname(FAVORITES_FILE), { recursive: true });
    // Keys this version does not know are kept
    await writeJsonAtomic(FAVORITES_FILE, { ...raw, ...next });
    return next;
  });
}

const CATALOGS: Record<ModelKind, () => Promise<{ id: string }[]>> = {
  image: () => listImageModels(),
  speech: () => listSpeechModels(),
  music: () => listMusicModels(),
};

/** Whether the model is in the catalog of that kind. */
export async function inCatalog(kind: ModelKind, model: string): Promise<boolean> {
  return (await CATALOGS[kind]()).some((m) => m.id === model);
}

/** The kind of a model: the first catalog that lists it (image, speech, music); unknown_model otherwise. */
export async function modelKindOf(model: string): Promise<ModelKind> {
  for (const kind of MODEL_KINDS) if (await inCatalog(kind, model)) return kind;
  throw unknownModel(model);
}
