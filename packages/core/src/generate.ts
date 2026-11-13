// Image generation runs: several models in parallel with the same prompt and references.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { apiKey, DEFAULT_PRIVACY, OUT_DIR, type PrivacyMode, REF_MAX_SIDE, resolveOut, UPLOADS_DIR } from './config.ts';
import type { RunEvent } from './contract.ts';
import { AppError, addWarning, errorFields, type WarningList } from './errors.ts';
import { slug, timestamp } from './files.ts';
import { decodable } from './heic.ts';
import { appendEntry, type ManifestEntry, newEntry } from './manifest.ts';
import {
  generateImages,
  type ImageModel,
  type ImageRequest,
  type ImageResult,
  listImageModels,
  type ZdrEndpoint,
  zdrEndpoints,
} from './openrouter.ts';
import { fitParams, maxN, maxRefs, type WantedParams } from './params.ts';
import { allowedProviders, privacyBlocked, providerField } from './privacy.ts';
import { composePrompt } from './prompt.ts';
import { type ElementInfo, elementReferences, encodeImage, findMentions, listElements } from './refs.ts';

export type ExtraRef = { outFile: string } | { dataUrl: string; name?: string } | { path: string };

export interface GenerateOptions extends WantedParams {
  prompt: string;
  models: string[];
  element?: string | null;
  usePrefix?: boolean;
  extraRefs?: ExtraRef[];
  /** Images per model. */
  count?: number;
  maxSide?: number;
  privacy?: PrivacyMode;
  /** Edit mode (tools): additional reference 1 is the image to edit. */
  editMode?: boolean;
  /** Tool name, source image and tool options for the manifest. */
  tool?: string;
  source?: string;
  toolOptions?: Record<string, string>;
  /** Display prompt for the manifest (e.g. "Relight: golden hour"), otherwise prompt. */
  label?: string;
}

/** Everything a run shares across its models. */
interface Run {
  o: GenerateOptions;
  prompt: string;
  runId: string;
  stamp: string;
  count: number;
  privacy: PrivacyMode;
  extras: { label: string; url: string }[];
  elements: { info: ElementInfo; urls: string[] }[];
  catalog: Map<string, ImageModel>;
  zdr: Map<string, ZdrEndpoint[]>;
  /** Manifest fields that are the same for every entry of the run. */
  base: Partial<ManifestEntry> & Pick<ManifestEntry, 'runId' | 'prompt' | 'privacy'>;
  onEvent: (e: RunEvent) => void;
  abort?: AbortSignal;
}

/** What is sent to one model. */
interface ModelPlan {
  modelId: string;
  model: ImageModel | undefined;
  params: Partial<ImageRequest>;
  notes: WarningList;
  refs: string[];
  fullPrompt: string;
  restriction: string[] | null;
  /** Set when the privacy mode does not allow this model: the error, instead of a call. */
  blocked: { error: string; errorCode: string } | null;
}

// ---------------------------------------------------------------- References

/** Resolve an additional reference; uploads are stored under out/uploads/ (for the manifest). */
async function resolveExtra(ref: ExtraRef, maxSide: number): Promise<{ label: string; url: string }> {
  if ('outFile' in ref) return { label: ref.outFile, url: await encodeImage(resolveOut(ref.outFile), maxSide) };
  const raw = 'dataUrl' in ref ? decodeDataUrl(ref.dataUrl) : await fs.readFile(ref.path);
  const jpeg = await sharp(await decodable(raw)) // HEIC → JPEG
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  const hash = crypto.createHash('sha1').update(jpeg).digest('hex').slice(0, 16);
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const file = path.join(UPLOADS_DIR, `${hash}.jpg`);
  await fs.writeFile(file, jpeg);
  return { label: `uploads/${hash}.jpg`, url: await encodeImage(file, maxSide) };
}

function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new AppError('invalid_data_url', 'Invalid data URL for reference');
  return Buffer.from(m[1], 'base64');
}

/** Distribute images round-robin across the elements until the budget is used up. */
function allocate(lists: string[][], budget: number): string[][] {
  const out: string[][] = lists.map(() => []);
  let left = budget;
  let progress = true;
  while (left > 0 && progress) {
    progress = false;
    for (let k = 0; k < lists.length && left > 0; k++) {
      if (out[k].length < lists[k].length) {
        out[k].push(lists[k][out[k].length]);
        left--;
        progress = true;
      }
    }
  }
  return out;
}

/**
 * References within the model's limit: additional references first, then one photo per element in turn,
 * so every element keeps at least one image while there is room.
 */
function distributeRefs(run: Run, model: ImageModel | undefined, notes: WarningList) {
  const limit = maxRefs(model);
  const extraUrls = run.extras.map((e) => e.url).slice(0, limit ?? undefined);
  const budget = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - extraUrls.length);
  const perElement = allocate(
    run.elements.map((e) => e.urls),
    budget,
  );
  const wanted = run.extras.length + run.elements.reduce((n, e) => n + e.urls.length, 0);
  const sent = extraUrls.length + perElement.reduce((n, l) => n + l.length, 0);
  if (sent < wanted) {
    addWarning(notes, 'refs_truncated', `Model allows max. ${limit} references, reduced to ${sent} of ${wanted}`, {
      limit: limit ?? 0,
      sent,
      total: wanted,
    });
  }
  for (const [i, list] of perElement.entries()) {
    const name = run.elements[i].info.name;
    if (!list.length && run.elements[i].urls.length) {
      addWarning(notes, 'element_no_room', `@${name}: no room left for reference images`, { name });
    }
  }
  return { refs: [...extraUrls, ...perElement.flat()], extraCount: extraUrls.length, perElement };
}

// ---------------------------------------------------------------- Planning

function planModel(run: Run, modelId: string): ModelPlan {
  const model = run.catalog.get(modelId);
  const { params, warnings, notices } = fitParams(model, run.o);
  const notes: WarningList = { warnings, notices };
  const { refs, extraCount, perElement } = distributeRefs(run, model, notes);
  const fullPrompt = composePrompt(
    run.prompt,
    run.elements.map((e, i) => ({ info: e.info, count: perElement[i].length })),
    extraCount,
    run.o.usePrefix ?? true,
    run.o.editMode ?? false,
  );
  const restriction = allowedProviders(modelId, run.privacy, run.zdr);
  const blocked = restriction && !restriction.length ? privacyBlocked(run.privacy) : null;
  return { modelId, model, params, notes, refs, fullPrompt, restriction, blocked };
}

function imageRequest(plan: ModelPlan, n: number): ImageRequest {
  return {
    model: plan.modelId,
    prompt: plan.fullPrompt,
    ...plan.params,
    ...(n > 1 ? { n } : {}),
    ...(plan.refs.length
      ? { input_references: plan.refs.map((url) => ({ type: 'image_url' as const, image_url: { url } })) }
      : {}),
    ...providerField(plan.restriction),
  };
}

/** Split the count into calls (many models only allow n=1): [{ n, startIndex }]. */
function calls(count: number, perCall: number): { n: number; startIndex: number }[] {
  const out: { n: number; startIndex: number }[] = [];
  for (let start = 0; start < count; start += perCall)
    out.push({ n: Math.min(perCall, count - start), startIndex: start });
  return out;
}

// ---------------------------------------------------------------- Results

async function record(run: Run, plan: ModelPlan, fields: Partial<ManifestEntry>): Promise<ManifestEntry> {
  const entry = newEntry({
    ...run.base,
    fullPrompt: plan.fullPrompt,
    model: plan.modelId,
    refCount: plan.refs.length,
    params: { ...plan.params, count: run.count },
    providerRestriction: plan.restriction,
    warnings: plan.notes.warnings,
    notices: plan.notes.notices,
    ...fields,
  });
  await appendEntry(entry);
  run.onEvent({ type: entry.ok ? 'image' : 'error', entry });
  return entry;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function sniffExt(buf: Buffer): string {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'gif';
  return 'png';
}

async function saveImages(
  run: Run,
  plan: ModelPlan,
  res: ImageResult,
  startIndex: number,
  durationMs: number,
): Promise<ManifestEntry[]> {
  const perImage = res.cost !== null ? res.cost / res.images.length : null;
  await fs.mkdir(OUT_DIR, { recursive: true });
  const entries: ManifestEntry[] = [];
  for (const [i, img] of res.images.entries()) {
    const buf = Buffer.from(img.b64, 'base64');
    const ext = (img.mediaType && EXT[img.mediaType]) || sniffExt(buf);
    const file = `${run.stamp}_${slug(plan.modelId)}_${startIndex + i + 1}.${ext}`;
    await fs.writeFile(path.join(OUT_DIR, file), buf);
    entries.push(
      await record(run, plan, {
        ok: true,
        file,
        debugId: res.debugId,
        generationId: res.generationId,
        provider: res.provider,
        cost: perImage,
        callCost: res.cost,
        durationMs,
        mediaType: img.mediaType ?? null,
      }),
    );
  }
  return entries;
}

async function callModel(run: Run, plan: ModelPlan, n: number, startIndex: number): Promise<ManifestEntry[]> {
  const t0 = performance.now();
  try {
    const res = await generateImages(imageRequest(plan, n), run.abort);
    return await saveImages(run, plan, res, startIndex, Math.round(performance.now() - t0));
  } catch (err) {
    return [
      await record(run, plan, {
        ...errorFields(err, run.abort),
        durationMs: Math.round(performance.now() - t0),
        debugId: (err as { debugId?: string }).debugId,
      }),
    ];
  }
}

function modelJobs(run: Run, plan: ModelPlan): Promise<ManifestEntry[]>[] {
  if (plan.blocked) return [record(run, plan, plan.blocked).then((e) => [e])];
  return calls(run.count, Math.min(maxN(plan.model), run.count)).map((c) => callModel(run, plan, c.n, c.startIndex));
}

// ---------------------------------------------------------------- Run

async function prepare(
  o: GenerateOptions,
  prompt: string,
  onEvent: (e: RunEvent) => void,
  abort?: AbortSignal,
): Promise<Run> {
  const privacy = o.privacy ?? DEFAULT_PRIVACY;
  const maxSide = o.maxSide ?? REF_MAX_SIDE;
  const [catalog, zdr, extras, allElements] = await Promise.all([
    listImageModels(),
    privacy === 'off' ? new Map<string, ZdrEndpoint[]>() : zdrEndpoints(),
    Promise.all((o.extraRefs ?? []).map((r) => resolveExtra(r, maxSide))),
    listElements(),
  ]);
  // Elements: the one selected in the dropdown plus all @mentions in the prompt
  const mentioned = findMentions(
    prompt,
    allElements.map((e) => e.name),
  );
  const names = [...new Set([...(o.element ? [o.element] : []), ...mentioned])];
  const elements = await Promise.all(names.map((n) => elementReferences(n, maxSide)));
  const runId = crypto.randomUUID();
  return {
    o,
    prompt,
    runId,
    stamp: timestamp(),
    count: Math.min(Math.max(1, Math.floor(o.count ?? 1)), 10),
    privacy,
    extras,
    elements,
    catalog: new Map(catalog.map((m) => [m.id, m])),
    zdr,
    base: {
      kind: 'image',
      runId,
      prompt: o.label?.trim() || prompt,
      element: elements[0]?.info.name ?? null,
      elements: elements.map((e) => e.info.name),
      usePrefix: o.usePrefix ?? true,
      extraRefs: extras.map((e) => e.label),
      privacy,
      ...(o.tool ? { tool: o.tool, source: o.source, ...(o.toolOptions ? { toolOptions: o.toolOptions } : {}) } : {}),
    },
    onEvent,
    abort,
  };
}

export async function runGeneration(
  o: GenerateOptions,
  onEvent: (e: RunEvent) => void = () => {},
  abort?: AbortSignal,
): Promise<ManifestEntry[]> {
  const prompt = o.prompt?.trim();
  if (!prompt) throw new AppError('prompt_missing', 'Prompt is missing');
  apiKey(); // fail early if the key is missing
  const models = [...new Set(o.models.filter(Boolean))];
  if (!models.length) throw new AppError('no_model', 'No model selected');

  const run = await prepare(o, prompt, onEvent, abort);
  onEvent({ type: 'start', runId: run.runId, plan: models.map((model) => ({ model, count: run.count })) });
  const jobs = models.flatMap((id) => modelJobs(run, planModel(run, id)));
  const all = (await Promise.all(jobs)).flat();
  const ok = all.filter((e) => e.ok);
  onEvent({
    type: 'done',
    runId: run.runId,
    images: ok.length,
    failed: all.length - ok.length,
    cost: ok.reduce((s, e) => s + (e.cost ?? 0), 0),
  });
  return all;
}
