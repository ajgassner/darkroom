// The listings: `darkroom models`, `voices`, `elements` and `costs` (text blocks in output/listing.ts, JSON
// documents in output/json.ts).
import { listVoices } from '@darkroom/core/audio/voices';
import type { ModelKind } from '@darkroom/core/contract';
import { listElements } from '@darkroom/core/elements/refs';
import { AppError } from '@darkroom/core/errors';
import { costSummary, readEntries } from '@darkroom/core/storage/manifest';
import pc from 'picocolors';
import { plural, usd } from '../interactive/choices.ts';
import {
  costsDocument,
  elementsDocument,
  imageModelsDocument,
  modelVoicesDocument,
  musicModelsDocument,
  ownVoicesDocument,
  printJson,
  speechModelsDocument,
} from '../output/json.ts';
import {
  imageModelBlocks,
  LEGEND,
  type ListOptions,
  musicModelBlocks,
  speechModelBlocks,
  voiceBlocks,
} from '../output/listing.ts';
import { jsonMode } from '../output/mode.ts';
import { out } from '../output/out.ts';
import { loadImageModels, loadMusicModels, loadSpeechModels } from './shared.ts';

const BLOCKS: Record<ModelKind, (o: ListOptions) => Promise<string[]>> = {
  image: async (o) => imageModelBlocks(await loadImageModels(), o),
  speech: async (o) => speechModelBlocks(await loadSpeechModels(), o),
  music: async (o) => musicModelBlocks(await loadMusicModels(), o),
};

/** The listings as JSON documents (--json). */
const DOCUMENTS: Record<ModelKind, (o: ListOptions) => Promise<object[]>> = {
  image: async (o) => imageModelsDocument(await loadImageModels(), o),
  speech: async (o) => speechModelsDocument(await loadSpeechModels(), o),
  music: async (o) => musicModelsDocument(await loadMusicModels(), o),
};

export async function showModels(kind: ModelKind, o: ListOptions): Promise<void> {
  if (jsonMode) return printJson(await DOCUMENTS[kind](o));
  const blocks = await BLOCKS[kind](o);
  if (!blocks.length) return out.warn('No models match');
  out.message(blocks.join('\n\n'));
  out.hint(pc.dim(LEGEND));
  if (kind === 'speech') out.hint(`Voices of a model: ${pc.bold('darkroom voices <model>')}`);
}

/** Own voices, or a speech model's voices by language together with the own voices. */
export async function showVoices(modelId?: string): Promise<void> {
  const own = await listVoices();
  if (modelId) {
    const model = (await loadSpeechModels()).find((m) => m.id === modelId);
    if (!model)
      throw new AppError('unknown_model', `Unknown speech model: ${modelId} (see darkroom models speech)`, {
        model: modelId,
      });
    if (jsonMode) return printJson(modelVoicesDocument(model, own));
    out.message(voiceBlocks(model, own).join('\n\n'));
    return;
  }
  if (jsonMode) return printJson(ownVoicesDocument(own));
  if (!own.length) return out.info('No own voices yet. Record one in the web UI (Audio → Own voices).');
  for (const v of own)
    out.message(`${pc.bold(`voice:${v.name}`)}  ${pc.dim(`${v.label} · ${plural(v.samples.length, 'sample')}`)}`);
}

export async function showElements(): Promise<void> {
  const els = await listElements();
  if (jsonMode) return printJson(elementsDocument(els));
  if (!els.length) return out.info('No elements yet. Create one in the web UI or add photos to refs/<name>/.');
  for (const e of els)
    out.message(`${pc.bold(`@${e.name}`)}  ${pc.dim(`${e.type} · ${e.label} · ${plural(e.photos.length, 'image')}`)}`);
}

export async function showCosts(): Promise<void> {
  const s = costSummary(await readEntries());
  if (jsonMode) return printJson(costsDocument(s));
  const lines = Object.entries(s.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([m, v]) => `${usd(v.cost).padStart(10)}  ${String(v.images).padStart(4)}  ${m}`);
  out.note([...lines, pc.bold(`${usd(s.total).padStart(10)}  ${String(s.images).padStart(4)}  total`)], 'Costs');
}
