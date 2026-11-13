// Image tools for generated and uploaded images: local ones (free) and AI ones via the image API.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { DEFAULT_MODEL, OUT_DIR, type PrivacyMode, resolveOut } from '../config.ts';
import type { RunEvent } from '../contract.ts';
import { AppError, errorFields } from '../errors.ts';
import { runStamp, safeBaseName } from '../storage/files.ts';
import { appendEntry, type ManifestEntry, newEntry } from '../storage/manifest.ts';
import { runGeneration } from './generate.ts';
import { decodable } from './heic.ts';
import { LOCAL_TOOL_FNS, type LocalResult } from './local-tools.ts';

export interface ToolOptions {
  tool: string;
  /** Source image, relative to out/. */
  source: string;
  model?: string;
  element?: string | null;
  privacy?: PrivacyMode;
  options?: Record<string, string>;
}

type Options = Record<string, string>;

export const RELIGHT_PRESETS: Record<string, { label: string; prompt: string }> = {
  golden: {
    label: 'Golden hour',
    prompt: 'warm golden-hour sunlight from a low angle, soft long shadows, warm glow on skin',
  },
  studio: {
    label: 'Studio light',
    prompt: 'clean professional studio lighting with a large softbox key light, subtle fill and a gentle rim light',
  },
  window: {
    label: 'Soft window light',
    prompt: 'soft diffused daylight from a large window on the side, natural and gentle',
  },
  dramatic: {
    label: 'Dramatic',
    prompt: 'dramatic low-key lighting with strong contrast and deep shadows, a single hard light source',
  },
  overcast: { label: 'Overcast / neutral', prompt: 'even, neutral overcast daylight with very soft shadows' },
  blue: { label: 'Blue hour', prompt: 'cool blue-hour twilight ambience with soft warm practical lights' },
  night: {
    label: 'Night / neon',
    prompt: 'night-time city lighting with colorful neon reflections and soft ambient light',
  },
};

/** Defaults each tool fills in (stored as toolOptions in the manifest, so the UI shows what was used). */
const DEFAULTS: Record<string, (o: Options) => Options> = {
  crop: (o) => ({ aspect: o.aspect || '1:1', position: o.position || 'attention' }),
  resize: (o): Options => (o.width ? {} : { factor: o.factor || '2' }),
  removebg: (o) => ({ background: o.background || 'transparent' }),
  expand: (o) => ({ aspect: o.aspect || '16:9' }),
  upscale: (o) => ({ resolution: o.resolution || '4K' }),
  relight: (o): Options =>
    o.custom?.trim() ? {} : { preset: o.preset && RELIGHT_PRESETS[o.preset] ? o.preset : 'studio' },
};

function effectiveOptions(tool: string, o: Options): Options {
  return { ...o, ...DEFAULTS[tool]?.(o) };
}

function relightPrompt(o: Options, note: string) {
  const custom = o.custom?.trim();
  const preset = RELIGHT_PRESETS[o.preset ?? ''] ?? RELIGHT_PRESETS.studio;
  return {
    label: `Relight: ${custom || preset.label.toLowerCase()}`,
    prompt:
      `Relight image 1 with ${custom || preset.prompt}. Keep the person, face, pose, composition, background content and all details exactly the same; ` +
      'change only lighting, shadows and color mood, consistently and photorealistically.' +
      note,
  };
}

/** Prompt templates of the AI tools; `note` is the user's additional instruction. */
const AI_PROMPTS: Record<string, (o: Options, note: string) => { label: string; prompt: string }> = {
  expand: (o, note) => ({
    label: `Expand to ${o.aspect}`,
    prompt:
      `Extend the canvas of image 1 to a ${o.aspect} format (outpainting). Keep all existing content exactly unchanged: same person, face, pose, ` +
      'clothing, lighting and details. Naturally continue the scene beyond the original borders with matching perspective, lighting and style.' +
      note,
  }),
  upscale: (o, note) => ({
    label: `Upscale (AI, ${o.resolution})`,
    prompt:
      'Recreate image 1 as a faithful high-resolution upscale: identical composition, framing, pose, facial expression, clothing, colors and lighting. ' +
      'Only increase sharpness and fine detail such as skin texture, hair and fabric. Do not add, remove or change anything.' +
      note,
  }),
  relight: relightPrompt,
  cleanup: (_o, note) => ({
    label: 'Clean up background',
    prompt:
      'Clean up the background of image 1: remove distracting objects, clutter, signs, cables and other people from the background and fill those areas naturally. ' +
      'Keep the main subject and everything else exactly unchanged.' +
      note,
  }),
};

export const LOCAL_TOOLS = new Set(Object.keys(LOCAL_TOOL_FNS));

/** Manifest entry of a local tool run or an upload (no API, no cost). */
function localEntry(fields: Partial<ManifestEntry> & Pick<ManifestEntry, 'runId' | 'model' | 'prompt'>): ManifestEntry {
  return newEntry({
    kind: 'image',
    privacy: 'local',
    provider: 'local',
    fullPrompt: '',
    ...fields,
  });
}

/** Result fields of a local tool run; a result that only finished after a cancel is removed again. */
async function localResult(t: ToolOptions, o: Options, runId: string, abort?: AbortSignal) {
  try {
    abort?.throwIfAborted();
    const r: LocalResult = await LOCAL_TOOL_FNS[t.tool](resolveOut(t.source), o, runStamp(runId), abort);
    if (abort?.aborted) {
      await fs.rm(resolveOut(r.file), { force: true });
      return errorFields(null, abort);
    }
    return {
      ok: true,
      file: r.file,
      prompt: r.label,
      params: r.params,
      cost: 0,
      callCost: 0,
      mediaType: 'image/png',
    } satisfies Partial<ManifestEntry>;
  } catch (err) {
    return errorFields(err, abort);
  }
}

async function runLocal(t: ToolOptions, onEvent: (e: RunEvent) => void, abort?: AbortSignal): Promise<ManifestEntry[]> {
  const o = effectiveOptions(t.tool, t.options ?? {});
  const runId = crypto.randomUUID();
  const model = t.tool === 'removebg' ? 'local/background-removal' : 'local/sharp';
  onEvent({ type: 'start', runId, plan: [{ model, count: 1 }] });

  const t0 = performance.now();
  const result = await localResult(t, o, runId, abort);
  const entry = localEntry({
    runId,
    model,
    prompt: t.tool,
    tool: t.tool,
    source: t.source,
    toolOptions: o,
    extraRefs: [t.source],
    refCount: 1,
    durationMs: Math.round(performance.now() - t0),
    ...result,
  });
  // Cancelled local runs cost nothing, so they leave no trace in the manifest
  if (!abort?.aborted) await appendEntry(entry);
  onEvent({ type: entry.ok ? 'image' : 'error', entry });
  onEvent({ type: 'done', runId, images: entry.ok ? 1 : 0, failed: entry.ok ? 0 : 1, cost: 0 });
  return [entry];
}

export async function runTool(
  t: ToolOptions,
  onEvent: (e: RunEvent) => void = () => {},
  abort?: AbortSignal,
): Promise<ManifestEntry[]> {
  const source = resolveOut(t.source);
  if (LOCAL_TOOLS.has(t.tool)) return runLocal(t, onEvent, abort);
  const buildPrompt = AI_PROMPTS[t.tool];
  if (!buildPrompt) throw new AppError('unknown_tool', `Unknown tool: ${t.tool}`, { tool: t.tool });

  const o = effectiveOptions(t.tool, t.options ?? {});
  const meta = await sharp(source).metadata();
  const note = o.note?.trim() ? `\nAdditional instruction: ${o.note.trim()}` : '';
  const { prompt, label } = buildPrompt(o, note);
  return runGeneration(
    {
      prompt,
      label,
      models: [t.model || DEFAULT_MODEL],
      element: t.element || null,
      extraRefs: [{ outFile: t.source }],
      editMode: true,
      count: 1,
      // Aspect ratio: the target when expanding, otherwise like the source image (closest supported)
      aspectRatio: t.tool === 'expand' ? o.aspect : `${meta.width ?? 1}:${meta.height ?? 1}`,
      resolution: o.resolution || '2K',
      privacy: t.privacy,
      tool: t.tool,
      source: t.source,
      toolOptions: o,
      // Reference in full resolution for upscaling and editing
      maxSide: 2048,
    },
    onEvent,
    abort,
  );
}

async function readable(buf: Buffer): Promise<Metadata> {
  try {
    return await sharp(buf).metadata();
  } catch {
    throw new AppError('image_unreadable', 'Image could not be read (export HEIC as JPEG if needed)');
  }
}

/** Add your own image to the gallery so tools can run on it. */
export async function importImage(dataUrl: string, filename: string): Promise<ManifestEntry> {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new AppError('invalid_data_url', 'Invalid data URL');
  const buf = await decodable(Buffer.from(m[1], 'base64')); // HEIC → JPEG
  const png = Boolean((await readable(buf)).hasAlpha);
  const runId = crypto.randomUUID();
  const name = filename || 'image';
  const file = `${runStamp(runId)}_upload_${safeBaseName(name, 'image')}.${png ? 'png' : 'jpg'}`;
  // Keep transparency (PNG), otherwise high-quality JPEG; apply EXIF rotation, max. 6000 px
  const img = sharp(buf).rotate().resize({ width: 6000, height: 6000, fit: 'inside', withoutEnlargement: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  const info = await (png ? img.png() : img.jpeg({ quality: 95 })).toFile(path.join(OUT_DIR, file));
  const entry = localEntry({
    runId,
    model: 'local/upload',
    prompt: `Uploaded: ${name}`,
    tool: 'import',
    toolOptions: { filename: name },
    ok: true,
    file,
    params: { width: info.width, height: info.height },
    cost: 0,
    callCost: 0,
    mediaType: png ? 'image/png' : 'image/jpeg',
  });
  await appendEntry(entry);
  return entry;
}
