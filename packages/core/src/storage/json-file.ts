// Small JSON config files next to user data (voice.json, element.json): safe reads, atomic writes, one writer at a time.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

/**
 * The JSON object in `file` ({} when the file does not exist). A damaged file (invalid JSON, not an object)
 * gives {} when `onInvalid` is omitted (reading for display) and throws `onInvalid()` otherwise (the write path,
 * so that a damaged file is never overwritten with nothing).
 */
export async function readJsonObject<T extends object>(file: string, onInvalid?: () => Error): Promise<Partial<T>> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (!onInvalid || (err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {}
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Partial<T>;
  if (!onInvalid) return {};
  throw onInvalid();
}

/** Replace `file` atomically (temporary file + rename), so readers never see it half-written. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}-${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const chains = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier call with the same key has finished (in this process), e.g. one read-modify-write per file. */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = p.catch(() => {});
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return p;
}
