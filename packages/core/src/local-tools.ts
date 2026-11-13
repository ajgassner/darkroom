// Image tools that run locally (sharp, background removal in a worker process): free, nothing leaves the machine.
// Result files are always written via resolveOut, so no option can place them outside out/.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { resolveOut } from './config.ts';
import { AppError } from './errors.ts';
import { runWorker } from './worker.ts';

/** Result of a local tool: file below out/, readable label and parameters for the manifest. */
export interface LocalResult {
  file: string;
  label: string;
  params: Record<string, unknown>;
}

/** A local tool: source image (absolute path), effective options, file name prefix for the result. */
export type LocalTool = (src: string, o: Record<string, string>, prefix: string) => Promise<LocalResult>;

/** Aspect ratio "w:h" with positive whole numbers; anything else (it ends up in a file name) is rejected. */
function parseAspect(r: string): { w: number; h: number } {
  const m = /^(\d{1,5}):(\d{1,5})$/.exec(r ?? '');
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  if (!m || !w || !h) throw new AppError('invalid_aspect', `Invalid aspect ratio: ${r}`, { value: r });
  return { w, h };
}

async function dimensions(src: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(src).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** Largest area of the target aspect ratio that fits into the image. */
function cropBox(width: number, height: number, r: number): { w: number; h: number } {
  const h = Math.round(width / r);
  return h > height ? { w: Math.round(height * r), h: height } : { w: width, h };
}

const crop: LocalTool = async (src, o, prefix) => {
  const { width, height } = await dimensions(src);
  const aspect = parseAspect(o.aspect);
  const { w, h } = cropBox(width, height, aspect.w / aspect.h);
  const file = `${prefix}_crop_${aspect.w}x${aspect.h}.png`;
  const position = o.position === 'center' ? 'centre' : sharp.strategy.attention;
  await sharp(src).rotate().resize({ width: w, height: h, fit: 'cover', position }).png().toFile(resolveOut(file));
  return {
    file,
    label: `Crop to ${aspect.w}:${aspect.h} (${w}×${h})`,
    params: { aspect_ratio: `${aspect.w}:${aspect.h}`, position: o.position, width: w, height: h },
  };
};

const resize: LocalTool = async (src, o, prefix) => {
  const { width: w0, height: h0 } = await dimensions(src);
  const width = o.width ? Number(o.width) : Math.round(w0 * Number(o.factor || 2));
  if (!width || width < 16 || width > 12000) {
    throw new AppError('invalid_width', 'Invalid target width (16–12000 px)', { min: 16, max: 12000 });
  }
  const file = `${prefix}_resize_${width}w.png`;
  await sharp(src).rotate().resize({ width, kernel: 'lanczos3' }).png().toFile(resolveOut(file));
  const height = Math.round((h0 * width) / w0);
  return { file, label: `Resize to ${width}×${height} (local)`, params: { width, height, kernel: 'lanczos3' } };
};

const removeBackground: LocalTool = async (src, o, prefix) => {
  const bg = o.background;
  if (bg !== 'transparent' && !/^#[0-9a-fA-F]{6}$/.test(bg)) {
    throw new AppError('invalid_background', 'Background color must be "transparent" or #rrggbb', { value: bg });
  }
  const file = `${prefix}_cutout.png`;
  const tmp = resolveOut(`.${file}.tmp.png`);
  await runWorker('removebg-worker.ts', [src, tmp], {
    timeout: 180_000,
    notInstalled: () =>
      new AppError(
        'removebg_not_installed',
        'Local background removal is not installed: pnpm --filter @darkroom/core add @imgly/background-removal-node',
      ),
    failed: (message) => new AppError('removebg_failed', `Background removal failed: ${message}`, { message }),
  });
  if (bg === 'transparent') {
    await fs.rename(tmp, resolveOut(file));
  } else {
    await sharp(tmp).flatten({ background: bg }).png().toFile(resolveOut(file));
    await fs.unlink(tmp);
  }
  const label = `Remove background${bg === 'transparent' ? ' (transparent)' : ` (background ${bg})`}`;
  return { file, label, params: { background: bg } };
};

export const LOCAL_TOOL_FNS: Record<string, LocalTool> = { crop, resize, removebg: removeBackground };
