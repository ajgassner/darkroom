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

// Serialize writes to the manifest (appending during a generation vs. rewriting on delete)
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}

export function appendEntry(e: ManifestEntry): Promise<void> {
  return withLock(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.appendFile(MANIFEST, `${JSON.stringify(e)}\n`);
  });
}

/** Mark matching entries as deleted; returns the newly marked entries. */
export function markDeleted(match: (e: ManifestEntry) => boolean): Promise<ManifestEntry[]> {
  return withLock(async () => {
    let text = '';
    try {
      text = await fs.readFile(MANIFEST, 'utf8');
    } catch {
      return [];
    }
    const changed: ManifestEntry[] = [];
    const now = new Date().toISOString();
    const lines = text.split('\n').map((line) => {
      if (!line.trim()) return line;
      try {
        const e = JSON.parse(line) as ManifestEntry;
        if (e.deleted || !match(e)) return line;
        e.deleted = now;
        changed.push(e);
        return JSON.stringify(e);
      } catch {
        return line;
      }
    });
    if (changed.length) {
      const tmp = `${MANIFEST}.tmp`;
      await fs.writeFile(tmp, lines.join('\n'));
      await fs.rename(tmp, MANIFEST);
    }
    return changed;
  });
}

/** Set fields of an entry later (e.g. costs that only become available later). */
export function updateEntry(id: string, patch: Partial<ManifestEntry>): Promise<boolean> {
  return withLock(async () => {
    let text = '';
    try {
      text = await fs.readFile(MANIFEST, 'utf8');
    } catch {
      return false;
    }
    let found = false;
    const lines = text.split('\n').map((line) => {
      if (!line.trim() || !line.includes(id)) return line;
      try {
        const e = JSON.parse(line) as ManifestEntry;
        if (e.id !== id) return line;
        found = true;
        return JSON.stringify({ ...e, ...patch });
      } catch {
        return line;
      }
    });
    if (found) {
      const tmp = `${MANIFEST}.tmp`;
      await fs.writeFile(tmp, lines.join('\n'));
      await fs.rename(tmp, MANIFEST);
    }
    return found;
  });
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
  const out: ManifestEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip broken line
    }
  }
  return out;
}

export function costSummary(entries: ManifestEntry[]): CostSummary {
  const byModel: Record<string, { cost: number; images: number }> = {};
  let total = 0;
  let images = 0;
  for (const e of entries) {
    if (!e.ok) continue;
    const c = e.cost ?? 0;
    total += c;
    images++;
    const m = byModel[e.model] ?? { cost: 0, images: 0 };
    byModel[e.model] = m;
    m.cost += c;
    m.images++;
  }
  return { total, images, byModel };
}
