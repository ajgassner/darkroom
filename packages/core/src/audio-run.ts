// Shared parts of audio runs (speech, music, transcription): manifest entries, events, late cost lookup.
import { API_BASE, apiKey } from './config.ts';
import type { RunEvent } from './contract.ts';
import { appendEntry, type ManifestEntry, newEntry, updateEntry } from './manifest.ts';

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

async function generationCost(generationId: string): Promise<{ cost: number; provider: string | null } | null> {
  const res = await fetch(`${API_BASE}/generation?id=${encodeURIComponent(generationId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const d = ((await res.json()) as { data?: { total_cost?: unknown; provider_name?: string } }).data ?? {};
  return typeof d.total_cost === 'number' ? { cost: d.total_cost, provider: d.provider_name ?? null } : null;
}

/** Speech costs are only available a few seconds after the call: look them up in the background. */
export function lookupCostLater(entryId: string, generationId: string): void {
  // Background task: a failed lookup or manifest write must never become an unhandled rejection (crashes the server)
  void (async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const found = await generationCost(generationId).catch(() => null);
      if (found) {
        await updateEntry(entryId, { cost: found.cost, callCost: found.cost, provider: found.provider });
        return;
      }
    }
  })().catch(() => {});
}
