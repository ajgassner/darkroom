// Shared parts of audio runs (speech, music, transcription): manifest entries, events, late cost lookup.
import { API_BASE, apiKey } from './config.ts';
import type { RunEvent } from './contract.ts';
import { appendEntry, type ManifestEntry, newEntry, readEntries, updateEntry } from './manifest.ts';

/** Manifest entry of an audio result. */
export function audioEntry(
  fields: Partial<ManifestEntry> & Pick<ManifestEntry, 'runId' | 'model' | 'prompt' | 'privacy'>,
): ManifestEntry {
  return newEntry({ kind: 'audio', ...fields });
}

/** Record the single result of an audio run and close the run. */
export async function finish(entry: ManifestEntry, onEvent: (e: RunEvent) => void): Promise<ManifestEntry[]> {
  await appendEntry(entry);
  onEvent({ type: entry.ok ? 'image' : 'error', entry });
  onEvent({
    type: 'done',
    runId: entry.runId,
    images: entry.ok ? 1 : 0,
    failed: entry.ok ? 0 : 1,
    cost: entry.cost ?? 0,
  });
  return [entry];
}

interface CallCost {
  cost: number;
  provider: string | null;
}

async function generationCost(generationId: string): Promise<CallCost | null> {
  const res = await fetch(`${API_BASE}/generation?id=${encodeURIComponent(generationId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const d = ((await res.json()) as { data?: { total_cost?: unknown; provider_name?: string } }).data ?? {};
  return typeof d.total_cost === 'number' ? { cost: d.total_cost, provider: d.provider_name ?? null } : null;
}

const costFields = (c: CallCost) => ({ cost: c.cost, callCost: c.cost, provider: c.provider });

/** Cost lookups in progress, by entry ID (the CLI waits for them, see withLateCosts). */
const pending = new Map<string, Promise<CallCost | null>>();

async function lookupCost(entryId: string, generationId: string): Promise<CallCost | null> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const found = await generationCost(generationId).catch(() => null);
    if (found) {
      await updateEntry(entryId, costFields(found));
      return found;
    }
  }
  return null;
}

/**
 * Speech costs are only available a few seconds after the call: look them up in the background (10 tries,
 * 2.5 s apart). If the process ends first, the server retries at its next start (retryMissingCosts).
 */
export function lookupCostLater(entryId: string, generationId: string): void {
  // Background task: a failed lookup or manifest write must never become an unhandled rejection (crashes the server)
  const task = lookupCost(entryId, generationId).catch(() => null);
  pending.set(entryId, task);
  void task.finally(() => pending.delete(entryId));
}

/**
 * The entries with the costs of their lookups still in progress: waits for them (`onWait` is called first if there
 * are any). Lookups that give up leave the cost unknown.
 */
export async function withLateCosts(entries: ManifestEntry[], onWait?: () => void): Promise<ManifestEntry[]> {
  const lookups = entries.map((e) => (e.id ? pending.get(e.id) : undefined));
  if (lookups.some(Boolean)) onWait?.();
  const found = await Promise.all(lookups);
  return entries.map((e, i) => {
    const c = found[i];
    return c ? { ...e, ...costFields(c) } : e;
  });
}

const DAY = 86_400_000;

/**
 * Audio entries whose cost lookup did not finish (the process ended first): look each up once more.
 * Only entries of the last `maxAgeMs` (OpenRouter keeps generation stats for a limited time). Returns how many
 * entries got their cost.
 */
export async function retryMissingCosts(maxAgeMs = 7 * DAY): Promise<number> {
  const since = Date.now() - maxAgeMs;
  const missing = (await readEntries()).filter(
    (e) => e.kind === 'audio' && e.id && e.generationId && e.cost === null && Date.parse(e.ts) >= since,
  );
  let updated = 0;
  for (const e of missing) {
    const found = await generationCost(e.generationId as string).catch(() => null);
    if (found && (await updateEntry(e.id as string, costFields(found)))) updated++;
  }
  return updated;
}
