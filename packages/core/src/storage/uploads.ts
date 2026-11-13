// Uploaded additional references: stored content-addressed as out/uploads/<sha1-16>.jpg (see image/generate.ts),
// recorded on manifest entries as extraRefs "uploads/<hash>.jpg".
import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS_DIR } from '../config.ts';
import type { ManifestEntry, UploadInfo, UploadRun } from '../contract.ts';
import { AppError } from '../errors.ts';

/** File name of an upload inside out/uploads/. Anything else is never read or removed there. */
const UPLOAD_NAME = /^[0-9a-f]{16}\.jpg$/;
const PREFIX = 'uploads/';

/** File name ("<hash>.jpg") of an extra reference that is an upload, otherwise null. */
function uploadName(ref: string): string | null {
  const name = ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : '';
  return UPLOAD_NAME.test(name) ? name : null;
}

/** Absolute path of an upload; throws for names that are not an upload's (no other file can be reached). */
function uploadPath(name: string): string {
  if (!UPLOAD_NAME.test(name)) throw new AppError('invalid_upload', `Invalid upload name: ${name}`, { name });
  return path.join(UPLOADS_DIR, name);
}

/** Uploads used by an entry (its extra references that are uploads). */
export function entryUploads(e: Pick<ManifestEntry, 'extraRefs'>): string[] {
  return (e.extraRefs ?? []).flatMap((r) => {
    const name = uploadName(r);
    return name ? [name] : [];
  });
}

/** Number of runs (of entries that are not deleted) that use each upload. */
function runsPerUpload(entries: ManifestEntry[]): Map<string, number> {
  const runs = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.deleted) continue;
    for (const name of entryUploads(e)) {
      const set = runs.get(name) ?? new Set();
      set.add(e.runId);
      runs.set(name, set);
    }
  }
  return new Map([...runs].map(([name, set]) => [name, set.size]));
}

/** All uploads, newest first, with the number of runs that use them. */
export async function listUploads(entries: ManifestEntry[]): Promise<UploadInfo[]> {
  const names = (await fs.readdir(UPLOADS_DIR).catch(() => [] as string[])).filter((n) => UPLOAD_NAME.test(n));
  const runs = runsPerUpload(entries);
  const infos = await Promise.all(
    names.map(async (name) => {
      const st = await fs.stat(path.join(UPLOADS_DIR, name)).catch(() => null);
      if (!st?.isFile()) return null;
      return { file: `${PREFIX}${name}`, size: st.size, mtime: st.mtime.toISOString(), runs: runs.get(name) ?? 0 };
    }),
  );
  return infos
    .filter((u): u is UploadInfo => u !== null)
    .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.file.localeCompare(b.file));
}

/** The runs that use an upload (entries that are not deleted), newest first. */
export function uploadRuns(name: string, entries: ManifestEntry[]): UploadRun[] {
  uploadPath(name);
  const runs = new Map<string, UploadRun>();
  for (const e of entries) {
    if (e.deleted || !entryUploads(e).includes(name)) continue;
    const run = runs.get(e.runId);
    if (!run) {
      runs.set(e.runId, { runId: e.runId, prompt: e.prompt, ts: e.ts, file: e.ok ? e.file : null, models: [e.model] });
      continue;
    }
    run.file ??= e.ok ? e.file : null;
    if (!run.models.includes(e.model)) run.models.push(e.model);
  }
  return [...runs.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}

/** Path of an existing upload; upload_not_found when there is none by that name. */
export async function existingUpload(name: string): Promise<string> {
  const file = uploadPath(name);
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) throw new AppError('upload_not_found', `Upload not found: ${name}`, { name });
  return file;
}

/**
 * Remove one upload. Uploads are never removed automatically; the user deletes them, and only once no run uses them
 * anymore (upload_in_use otherwise), so a run never loses a reference it was made with.
 */
export async function deleteUpload(name: string, entries: ManifestEntry[]): Promise<void> {
  const file = await existingUpload(name);
  const runs = runsPerUpload(entries).get(name) ?? 0;
  if (runs) {
    throw new AppError('upload_in_use', `Upload ${name} is still used in ${runs} run(s)`, { name, count: runs });
  }
  await fs.unlink(file);
}
