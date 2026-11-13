import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST, OUT_DIR } from './config.ts';
import type { CostSummary, ManifestEntry } from './contract.ts';

export type { ManifestEntry };

/** A new manifest entry: a failed result without file, cost or warnings unless the fields say otherwise. */
export function newEntry(
  fields: Partial<ManifestEntry> & Pick<ManifestEntry, 'runId' | 'model' | 'prompt' | 'privacy'>,
): ManifestEntry {
  return {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ok: false,
    file: null,
    fullPrompt: fields.prompt,
    element: null,
    usePrefix: false,
    extraRefs: [],
    refCount: 0,
    params: {},
    providerRestriction: null,
    warnings: [],
    notices: [],
    generationId: null,
    provider: null,
    cost: null,
    callCost: null,
    durationMs: 0,
    mediaType: null,
    ...fields,
  };
}

// Writes to the manifest (appending during a generation vs. rewriting on delete) are serialized twice:
// in-process by a promise chain, across processes (CLI and server at the same time) by an O_EXCL lock file.
const LOCK = `${MANIFEST}.lock`;
/** A lock file older than this was left behind by a crashed process and is taken over. */
const STALE_LOCK_MS = 10_000;

async function staleLock(): Promise<boolean> {
  const st = await fs.stat(LOCK).catch(() => null);
  return st !== null && Date.now() - st.mtimeMs > STALE_LOCK_MS;
}

async function acquireFileLock(): Promise<void> {
  for (;;) {
    try {
      await fs.writeFile(LOCK, String(process.pid), { flag: 'wx' });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (await staleLock()) await fs.rm(LOCK, { force: true });
    else await new Promise((r) => setTimeout(r, 10));
  }
}

async function underFileLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await acquireFileLock();
  try {
    return await fn();
  } finally {
    await fs.rm(LOCK, { force: true });
  }
}

let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => underFileLock(fn);
  const p = lock.then(locked, locked);
  lock = p.catch(() => {});
  return p;
}

/** False if the last line was cut off (crash while appending): the next entry must start on a new line. */
async function endsWithNewline(): Promise<boolean> {
  const fh = await fs.open(MANIFEST, 'r').catch(() => null);
  if (!fh) return true;
  try {
    const { size } = await fh.stat();
    if (!size) return true;
    const { buffer } = await fh.read(Buffer.alloc(1), 0, 1, size - 1);
    return buffer[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

export function appendEntry(e: ManifestEntry): Promise<void> {
  return withLock(async () => {
    const sep = (await endsWithNewline()) ? '' : '\n';
    await fs.appendFile(MANIFEST, `${sep}${JSON.stringify(e)}\n`);
  });
}

/**
 * Rewrite the manifest line by line (`edit` returns the line unchanged or a replacement).
 * Returns whether anything changed; the new file replaces the old one atomically.
 */
async function rewrite(edit: (line: string) => string): Promise<boolean> {
  let text = '';
  try {
    text = await fs.readFile(MANIFEST, 'utf8');
  } catch {
    return false;
  }
  let changed = false;
  const lines = text.split('\n').map((line) => {
    const out = line.trim() ? edit(line) : line;
    if (out !== line) changed = true;
    return out;
  });
  if (!changed) return false;
  const tmp = `${MANIFEST}.${process.pid}-${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, lines.join('\n'));
    await fs.rename(tmp, MANIFEST);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return true;
}

function parseLine(line: string): ManifestEntry | null {
  try {
    return JSON.parse(line) as ManifestEntry;
  } catch {
    return null;
  }
}

/** Mark matching entries as deleted; returns the newly marked entries. */
export function markDeleted(match: (e: ManifestEntry) => boolean): Promise<ManifestEntry[]> {
  return withLock(async () => {
    const changed: ManifestEntry[] = [];
    const now = new Date().toISOString();
    await rewrite((line) => {
      const e = parseLine(line);
      if (!e || e.deleted || !match(e)) return line;
      e.deleted = now;
      changed.push(e);
      return JSON.stringify(e);
    });
    return changed;
  });
}

/** Set fields of an entry later (e.g. costs that only become available later). */
export function updateEntry(id: string, patch: Partial<ManifestEntry>): Promise<boolean> {
  return withLock(() =>
    rewrite((line) => {
      const e = line.includes(id) ? parseLine(line) : null;
      return e?.id === id ? JSON.stringify({ ...e, ...patch }) : line;
    }),
  );
}

/** Debug records of deleted entries that no remaining entry refers to (one call can have several results). */
export async function unusedDebugIds(deleted: ManifestEntry[]): Promise<string[]> {
  const ids = new Set(deleted.flatMap((e) => (e.debugId ? [e.debugId] : [])));
  if (!ids.size) return [];
  for (const e of await readEntries()) if (!e.deleted && e.debugId) ids.delete(e.debugId);
  return [...ids];
}

/** Remove the files of deleted entries. */
export async function removeFiles(entries: ManifestEntry[]): Promise<string[]> {
  const removed: string[] = [];
  for (const e of entries) {
    if (!e.file) continue;
    const p = path.resolve(OUT_DIR, e.file);
    if (!p.startsWith(OUT_DIR + path.sep)) continue;
    await fs.unlink(p).then(
      () => removed.push(e.file as string),
      () => {},
    );
  }
  return removed;
}

export async function readEntries(): Promise<ManifestEntry[]> {
  let text = '';
  try {
    text = await fs.readFile(MANIFEST, 'utf8');
  } catch {
    return [];
  }
  // Broken lines (e.g. cut off by a crash) are skipped
  return text.split('\n').flatMap((line) => {
    const e = line.trim() ? parseLine(line) : null;
    return e ? [e] : [];
  });
}

/**
 * Costs per model. Deleted results still count, and so do failed calls that were charged
 * (e.g. a response without an image); `images` counts only results.
 */
export function costSummary(entries: ManifestEntry[]): CostSummary {
  const byModel: Record<string, { cost: number; images: number }> = {};
  let total = 0;
  let images = 0;
  for (const e of entries) {
    if (!e.ok && !e.cost) continue;
    const c = e.cost ?? 0;
    const m = byModel[e.model] ?? { cost: 0, images: 0 };
    byModel[e.model] = m;
    total += c;
    m.cost += c;
    if (e.ok) {
      images++;
      m.images++;
    }
  }
  return { total, images, byModel };
}
