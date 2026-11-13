// Debug log per API call: request (image data as placeholders), response, headers, duration.
// The reference images actually sent are stored under out/debug/refs/ (content-addressed, no duplicates).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR } from '../config.ts';
import type { DebugRecord } from '../contract.ts';
import { AppError } from '../errors.ts';

export type { DebugRecord };

export const DEBUG_DIR = path.join(OUT_DIR, 'debug');
const REFS_DIR = path.join(DEBUG_DIR, 'refs');
/** Name of a debug record ID; anything else is never read or removed. */
const RECORD_ID = /^[0-9a-f-]{36}$/;
const RECORD_FILE = /^[0-9a-f-]{36}\.json$/;
/** Name of a sent file inside out/debug/refs/ (content-addressed); other files there are never removed. */
const SENT_FILE = /^[0-9a-f]{16}\.(jpg|png|webp|wav|mp3|bin)$/;
const SENT_PREFIX = 'debug/refs/';

/**
 * Writing records and removing sent files run one after another, so a sent file is never removed between being
 * stored and its record being written.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

const omitted = (length: number) => `<base64 ${(length / 1024).toFixed(0)} KB omitted>`;

async function imageSize(mime: string, buf: Buffer): Promise<{ width?: number; height?: number }> {
  if (!mime.startsWith('image/')) return {};
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

/** Save a sent data URL under out/debug/refs/ (content-addressed) and return its placeholder. */
async function saveSentFile(mime: string, base64: string, sent: DebugRecord['sentFiles']): Promise<string> {
  // Reserve the slot right away so the number matches the order in the request
  const slot: DebugRecord['sentFiles'][number] = { index: sent.length + 1, file: '', mime, bytes: 0 };
  sent.push(slot);
  const buf = Buffer.from(base64, 'base64');
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const file = `${hash}.${EXT[mime] ?? 'bin'}`;
  await fs.mkdir(REFS_DIR, { recursive: true });
  await fs.writeFile(path.join(REFS_DIR, file), buf, { flag: 'wx' }).catch(() => {});
  const dims = await imageSize(mime, buf);
  Object.assign(slot, { file: `debug/refs/${file}`, bytes: buf.length, ...dims });
  const size = dims.width ? ` ${dims.width}×${dims.height}` : '';
  return `<${mime} ${(buf.length / 1024).toFixed(0)} KB${size} → reference #${slot.index}>`;
}

function redactString(value: string, sent: DebugRecord['sentFiles']): string | Promise<string> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (m) return saveSentFile(m[1], m[2], sent);
  if (value.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 2000))) return omitted(value.length);
  return value;
}

/** Raw audio data (input_audio.data without data: prefix) is not written to the log. */
const isRawAudio = (key: string, v: unknown): v is string =>
  key === 'data' && typeof v === 'string' && v.length > 2000 && !v.startsWith('data:');

/**
 * Replace data URLs and long base64 strings in an object with placeholders.
 * Data URLs are saved as files and recorded in `sent`. Values are processed in order (numbering).
 */
async function redact(value: unknown, sent: DebugRecord['sentFiles']): Promise<unknown> {
  if (typeof value === 'string') return redactString(value, sent);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) out.push(await redact(v, sent));
    return out;
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isRawAudio(k, v) ? omitted(v.length) : await redact(v, sent);
  return out;
}

const HEADER_KEYS = [
  'content-type',
  'x-generation-id',
  'x-openrouter-provider',
  'openrouter-provider',
  'x-request-id',
  'cf-ray',
  'retry-after',
];

export function pickHeaders(h: Headers | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const [k, v] of h.entries()) {
    if (HEADER_KEYS.includes(k) || k.startsWith('x-openrouter') || k.startsWith('x-ratelimit')) out[k] = v;
  }
  return out;
}

/** Write a debug record; returns the ID (recorded in the manifest entry as debugId). */
export async function writeDebug(
  rec: Omit<DebugRecord, 'id' | 'ts' | 'sentFiles' | 'request' | 'response'> & { request: unknown; response: unknown },
): Promise<string> {
  return serial(() => storeDebug(rec));
}

async function storeDebug(rec: Parameters<typeof writeDebug>[0]): Promise<string> {
  const id = crypto.randomUUID();
  const sentFiles: DebugRecord['sentFiles'] = [];
  const full: DebugRecord = {
    id,
    ts: new Date().toISOString(),
    ...rec,
    request: await redact(rec.request, sentFiles),
    response: await redact(rec.response, []),
    sentFiles,
  };
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await fs.writeFile(path.join(DEBUG_DIR, `${id}.json`), JSON.stringify(full, null, 2));
  return id;
}

export async function readDebug(id: string): Promise<DebugRecord> {
  if (!RECORD_ID.test(id)) throw new AppError('invalid_debug_id', 'Invalid debug ID');
  return JSON.parse(await fs.readFile(path.join(DEBUG_DIR, `${id}.json`), 'utf8'));
}

/** Names of the sent files (inside out/debug/refs/) a record lists. */
function sentNames(rec: Partial<Pick<DebugRecord, 'sentFiles'>> | null): string[] {
  return (rec?.sentFiles ?? []).flatMap(({ file }) => {
    const name = typeof file === 'string' && file.startsWith(SENT_PREFIX) ? file.slice(SENT_PREFIX.length) : '';
    return SENT_FILE.test(name) ? [name] : [];
  });
}

/** Remove one record; returns the sent files it listed. */
async function removeRecord(id: string): Promise<string[]> {
  const sent = sentNames(await readDebug(id).catch(() => null));
  await fs.unlink(path.join(DEBUG_DIR, `${id}.json`)).catch(() => {});
  return sent;
}

/**
 * Remove the sent files no remaining record lists: only `candidates` when given, otherwise every sent file. Records
 * are searched as text: a file a record mentions in any way is kept.
 */
async function pruneSentFiles(candidates?: Iterable<string>): Promise<string[]> {
  const listed = candidates ?? (await fs.readdir(REFS_DIR).catch(() => [] as string[]));
  const unused = new Set([...listed].filter((n) => SENT_FILE.test(n)));
  const records = (await fs.readdir(DEBUG_DIR).catch(() => [] as string[])).filter((n) => RECORD_FILE.test(n));
  for (const name of records) {
    if (!unused.size) break;
    const text = await fs.readFile(path.join(DEBUG_DIR, name), 'utf8').catch(() => '');
    for (const file of unused) if (text.includes(`${SENT_PREFIX}${file}`)) unused.delete(file);
  }
  const removed: string[] = [];
  for (const file of unused) {
    await fs.unlink(path.join(REFS_DIR, file)).then(
      () => removed.push(file),
      () => {},
    );
  }
  return removed;
}

/** Delete debug records, and the sent reference files that no remaining record uses. */
export async function deleteDebug(ids: string[]): Promise<void> {
  const valid = ids.filter((id) => RECORD_ID.test(id));
  if (!valid.length) return;
  await serial(async () => {
    const sent = (await Promise.all(valid.map(removeRecord))).flat();
    if (sent.length) await pruneSentFiles(sent);
  });
}

/**
 * Remove sent reference files that no record uses anymore (left behind by versions that deleted only the records).
 * Returns the removed file names.
 */
export function pruneDebugRefs(): Promise<string[]> {
  return serial(() => pruneSentFiles());
}
