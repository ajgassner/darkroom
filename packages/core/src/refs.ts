import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { REFS_DIR } from './config.ts';
import type { ElementConfig, ElementInfo, ElementType } from './contract.ts';
import { AppError } from './errors.ts';
import { safeBaseName } from './files.ts';
import { decodable } from './heic.ts';
import { readJsonObject, serialized, writeJsonAtomic } from './json-file.ts';

export type { ElementConfig, ElementInfo, ElementType };

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i;

export const DEFAULT_INSTRUCTIONS = [
  'The identity reference images show {label}. The generated image must depict exactly this person:',
  'keep the same face, facial proportions, eyes, nose, mouth, jawline, skin tone, hairline and overall identity,',
  'so that friends would recognize them immediately. Create a photorealistic photograph that looks like a real',
  'camera shot: natural skin texture, realistic lighting, no illustration, no CGI or plastic look.',
  'Do not copy the background, clothing or pose from the references unless the scene asks for it.',
  '',
  'Scene: {prompt}',
].join('\n');

export const ELEMENT_TYPES: ElementType[] = ['person', 'logo', 'object', 'location', 'style'];

function isElementType(v: unknown): v is ElementType {
  return typeof v === 'string' && (ELEMENT_TYPES as string[]).includes(v);
}

/** Fixed rules per element type (placed in the prompt before the custom instruction). */
export const TYPE_RULES: Record<ElementType, string> = {
  person:
    'This is a person: show exactly this person and keep the face, facial proportions, eyes, nose, mouth, skin tone, hairline and overall identity exactly as in these references.',
  logo: 'This is a logo: reproduce it exactly as in the reference (shape, colors, typography, text, proportions). Do not redraw, distort, translate or invent any text. Keep it crisp and legible.',
  object:
    'This is an object or product: keep its shape, proportions, materials, colors, labels and details exactly as in the references.',
  location:
    'This is a location: use it as the setting and keep its architecture, interior and characteristic details recognizable.',
  style:
    'This is a style reference only: adopt its look (color palette, lighting, mood, texture, composition style) but do not copy its content or people.',
};

/** Instruction is the old person template with {prompt} (single-element mode as before). */
export function isTemplate(instructions: string): boolean {
  return instructions.includes('{prompt}');
}

/** @name mentions; not after a word character, "." or "@", so e-mail addresses are no mentions (same rule as the UI). */
const MENTION = /(?<![A-Za-z0-9_.@-])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/g;

/**
 * @mentions in the prompt, in prompt order and once each: `known` are existing elements (case-insensitive, with the
 * element's spelling), `unknown` the names no element has (as written).
 */
export function findMentions(prompt: string, names: string[]): { known: string[]; unknown: string[] } {
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const known: string[] = [];
  const unknown: string[] = [];
  for (const m of prompt.matchAll(MENTION)) {
    const n = byLower.get(m[1].toLowerCase());
    if (n) {
      if (!known.includes(n)) known.push(n);
    } else if (!unknown.some((u) => u.toLowerCase() === m[1].toLowerCase())) unknown.push(m[1]);
  }
  return { known, unknown };
}

/** Replace @name in the prompt with the display name. */
export function replaceMentions(prompt: string, labels: Map<string, string>): string {
  return prompt.replace(MENTION, (all, n: string) => labels.get(n.toLowerCase()) ?? all);
}

export function validName(name: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(name) && !name.includes('..');
}

function elementDir(name: string): string {
  if (!validName(name)) throw new AppError('invalid_name', `Invalid element name: ${name}`, { name });
  return path.join(REFS_DIR, name);
}

/**
 * Removes the folder <base>/<name>/ with everything in it. Only direct subfolders of base with a valid name are
 * removed; a missing folder is reported with notFound.
 */
export async function removeNamedDir(base: string, name: string, notFound: () => Error): Promise<void> {
  if (!validName(name)) throw new AppError('invalid_name', `Invalid name: ${name}`, { name });
  const root = path.resolve(base);
  const dir = path.resolve(root, name);
  if (path.dirname(dir) !== root) throw new AppError('invalid_name', `Invalid name: ${name}`, { name });
  const st = await fs.lstat(dir).catch(() => null);
  if (!st?.isDirectory()) throw notFound();
  await fs.rm(dir, { recursive: true });
}

/** Deletes an element: refs/<name>/ with its photos and element.json. */
export async function deleteElement(name: string): Promise<void> {
  await serialized(`element:${name}`, () =>
    removeNamedDir(
      REFS_DIR,
      name,
      () => new AppError('element_not_found', `Element "${name}" not found (refs/${name}/)`, { name }),
    ),
  );
}

export async function listElements(): Promise<ElementInfo[]> {
  await fs.mkdir(REFS_DIR, { recursive: true });
  const dirs = await fs.readdir(REFS_DIR, { withFileTypes: true });
  const out: ElementInfo[] = [];
  for (const d of dirs) {
    if (d.isDirectory() && validName(d.name)) out.push(await getElement(d.name));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getElement(name: string): Promise<ElementInfo> {
  const dir = elementDir(name);
  const files = await fs.readdir(dir).catch(() => {
    throw new AppError('element_not_found', `Element "${name}" not found (refs/${name}/)`, { name });
  });
  // No or a damaged configuration: defaults
  const cfg = await readJsonObject<ElementConfig>(path.join(dir, 'element.json'));
  const type: ElementType = isElementType(cfg.type) ? cfg.type : 'person';
  return {
    name,
    label: cfg.label || name,
    type,
    // People without a custom instruction get the default template, other types get none
    instructions: cfg.instructions ?? (type === 'person' ? DEFAULT_INSTRUCTIONS : ''),
    photos: files.filter((f) => IMAGE_EXT.test(f) && !f.startsWith('.')).sort(),
  };
}

export async function saveElement(name: string, cfg: Partial<ElementConfig>): Promise<ElementInfo> {
  const dir = elementDir(name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'element.json');
  // One read-modify-write at a time; a damaged file is refused instead of being overwritten with defaults
  await serialized(`element:${name}`, async () => {
    const current = await readJsonObject<ElementConfig>(
      file,
      () =>
        new AppError(
          'element_config_invalid',
          `refs/${name}/element.json is damaged and was left unchanged. Fix or delete it.`,
          { name },
        ),
    );
    await writeJsonAtomic(file, { ...current, ...cfg });
  });
  return getElement(name);
}

/** Saves a photo normalized (EXIF rotation applied, max. 2048 px, JPEG). */
export async function addPhoto(name: string, originalName: string, input: Buffer): Promise<string> {
  const buf = await decodable(input); // HEIC → JPEG
  const dir = elementDir(name);
  await fs.mkdir(dir, { recursive: true });
  // Transparency (e.g. logos) is kept as PNG, everything else becomes JPEG
  const alpha = Boolean((await sharp(buf).metadata()).hasAlpha);
  const file = `${Date.now()}_${safeBaseName(originalName, 'photo')}.${alpha ? 'png' : 'jpg'}`;
  let img = sharp(buf).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
  img = alpha ? img.png() : img.jpeg({ quality: 92 });
  await fs.writeFile(path.join(dir, file), await img.toBuffer());
  return file;
}

export function photoPath(name: string, file: string): string {
  if (!IMAGE_EXT.test(file) || file.includes('/') || file.includes('\\') || file.startsWith('.')) {
    throw new AppError('invalid_filename', 'Invalid file name');
  }
  return path.join(elementDir(name), file);
}

export async function deletePhoto(name: string, file: string): Promise<void> {
  await fs.unlink(photoPath(name, file));
}

/** Least recently used cache, bounded by the total length of its values (strings or buffers). */
export class SizedCache<V extends { length: number } = string> {
  private readonly map = new Map<string, V>();
  private chars = 0;
  private readonly maxChars: number;
  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key); // move to the end: most recently used
      this.map.set(key, hit);
    }
    return hit;
  }

  /** Store a value and drop the least recently used ones beyond the limit (never the new one). */
  set(key: string, value: V): void {
    this.chars -= this.map.get(key)?.length ?? 0;
    this.map.delete(key);
    this.map.set(key, value);
    this.chars += value.length;
    for (const [k, v] of this.map) {
      if (this.chars <= this.maxChars || k === key) break;
      this.map.delete(k);
      this.chars -= v.length;
    }
  }
}

const HEIC_EXT = /\.hei[cf]$/i;
/** HEIC/HEIF photos converted to JPEG, so thumbnails and new encodings don't run the converter again. */
const heicCache = new SizedCache<Buffer>(64 * 1024 * 1024);

/**
 * Input sharp can read: the file path itself, or for HEIC/HEIF (e.g. iPhone photos copied into refs/ by hand,
 * which sharp cannot decode) the photo converted to JPEG.
 */
async function sharpInput(input: Buffer | string): Promise<Buffer | string> {
  if (typeof input !== 'string') return decodable(input);
  if (!HEIC_EXT.test(input)) return input;
  const st = await fs.stat(input);
  const key = `${input}|${st.mtimeMs}|${st.size}`;
  const hit = heicCache.get(key);
  if (hit) return hit;
  const jpeg = await decodable(await fs.readFile(input));
  heicCache.set(key, jpeg);
  return jpeg;
}

/** Encoded reference images (data URLs), so repeated runs don't re-encode the same photos. */
const encodeCache = new SizedCache(64 * 1024 * 1024);

/** Downscale an image and encode it as a JPEG data URL. */
export async function encodeImage(input: Buffer | string, maxSide: number): Promise<string> {
  let key: string | null = null;
  if (typeof input === 'string') {
    const st = await fs.stat(input);
    key = `${input}|${st.mtimeMs}|${st.size}|${maxSide}`;
    const hit = encodeCache.get(key);
    if (hit) return hit;
  }
  const src = await sharpInput(input);
  // Send images with transparency (logos) as PNG, otherwise JPEG
  const alpha = Boolean((await sharp(src).metadata()).hasAlpha);
  let img = sharp(src).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  img = alpha ? img.png() : img.jpeg({ quality: 90 });
  const url = `data:image/${alpha ? 'png' : 'jpeg'};base64,${(await img.toBuffer()).toString('base64')}`;
  if (key) encodeCache.set(key, url);
  return url;
}

export async function elementReferences(name: string, maxSide: number): Promise<{ info: ElementInfo; urls: string[] }> {
  const info = await getElement(name);
  if (!info.photos.length) {
    throw new AppError('element_no_photos', `Element "${name}" has no photos (refs/${name}/)`, { name });
  }
  const urls = await Promise.all(info.photos.map((f) => encodeImage(path.join(elementDir(name), f), maxSide)));
  return { info, urls };
}

/** Thumbnail; transparent images (logos) as PNG, fully visible instead of cropped. */
export async function thumbnail(file: string, size = 320): Promise<Buffer> {
  const src = await sharpInput(file);
  const alpha = Boolean((await sharp(src).metadata()).hasAlpha);
  if (alpha) {
    return sharp(src)
      .rotate()
      .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  return sharp(src).rotate().resize({ width: size, height: size, fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
}
