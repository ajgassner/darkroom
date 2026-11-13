// Additional references from out/ (results and previous uploads): picking without duplicates, usage texts.
import type { TFunction } from 'i18next';
import type { ExtraRef } from '../store';
import type { UploadInfo } from '../types';

/** File name of a previous upload in out/uploads/ ("uploads/<hash>.jpg" → "<hash>.jpg"). */
export function uploadName(file: string): string {
  return file.replace(/^uploads\//, '');
}

/** Whether a file from out/ is among the additional references. */
export function hasOutRef(refs: ExtraRef[], outFile: string): boolean {
  return refs.some((r) => r.kind === 'out' && r.outFile === outFile);
}

/** The references with a file from out/ added at the end, unless it is there already. */
export function withOutRef(refs: ExtraRef[], outFile: string): ExtraRef[] {
  return hasOutRef(refs, outFile) ? refs : [...refs, { kind: 'out', outFile }];
}

/** Pick a previous upload, or put it back when it is picked already. */
export function toggleOutRef(refs: ExtraRef[], outFile: string): ExtraRef[] {
  return hasOutRef(refs, outFile) ? withoutOutRefs(refs, [outFile]) : withOutRef(refs, outFile);
}

/** The references without these files from out/ (e.g. deleted results or uploads). */
export function withoutOutRefs(refs: ExtraRef[], files: Iterable<string>): ExtraRef[] {
  const gone = new Set(files);
  if (!gone.size) return refs;
  const kept = refs.filter((r) => !(r.kind === 'out' && gone.has(r.outFile)));
  return kept.length === refs.length ? refs : kept;
}

/**
 * After a run stored its new uploads in out/uploads/ (`stored`: the entry's extra references, in the order they were
 * sent): the sent new uploads that are still in `refs` become references to the stored files, so the next run does
 * not upload them again and "Previous uploads" shows them as added. A file that is already referenced is not added
 * twice.
 */
export function storedUploads(refs: ExtraRef[], sent: ExtraRef[], stored: string[]): ExtraRef[] {
  if (stored.length !== sent.length) return refs;
  let next = refs;
  sent.forEach((r, i) => {
    const at = next.indexOf(r);
    if (r.kind !== 'upload' || at < 0 || !stored[i].startsWith('uploads/')) return;
    const replacement: ExtraRef[] = hasOutRef(next, stored[i]) ? [] : [{ kind: 'out', outFile: stored[i] }];
    next = [...next.slice(0, at), ...replacement, ...next.slice(at + 1)];
  });
  return next;
}

/** "used in 2 runs" or "unused". */
export function usageText(t: TFunction, u: Pick<UploadInfo, 'runs'>): string {
  return u.runs ? t('uploads.usedIn', { count: u.runs }) : t('uploads.unused');
}

/** Accessible name of an upload tile: what a click does, and how much the upload is used. */
export function pickLabel(t: TFunction, u: Pick<UploadInfo, 'runs'>, picked: boolean): string {
  const usage = usageText(t, u);
  return picked ? t('uploads.unpick', { usage }) : t('uploads.pick', { usage });
}

/** Question before deleting an upload; says what happens to the runs that still use it. */
export function deleteQuestion(t: TFunction, u: Pick<UploadInfo, 'runs'>): string {
  const q = t('uploads.confirm');
  return u.runs ? `${q} ${t('uploads.confirmUsed', { count: u.runs })}` : q;
}
