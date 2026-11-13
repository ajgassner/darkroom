// Additional references from out/ (results and previous uploads): picking without duplicates, usage texts.
import type { TFunction } from 'i18next';
import type { ExtraRef } from '../store';
import type { UploadInfo } from '../types';

/** File name of a previous upload in out/uploads/ ("uploads/<hash>.jpg" → "<hash>.jpg"). */
export function uploadName(file: string): string {
  return file.replace(/^uploads\//, '');
}

/** Whether a file from out/ is a previous upload (otherwise it is a result). */
export function isUpload(file: string): boolean {
  return file.startsWith('uploads/');
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

/** Label of an upload's delete button: deleting is only possible once no run uses the upload anymore. */
export function deleteLabel(t: TFunction, u: Pick<UploadInfo, 'runs'>): string {
  return u.runs ? t('uploads.deleteLocked', { count: u.runs }) : t('uploads.delete');
}

/** Reference thumbnails in a run's header: the first `max` of its additional references, and how many more it had. */
export function runRefThumbs(refs: string[] | undefined, max = 4): { shown: string[]; more: number } {
  const all = refs ?? [];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** Name of a run's n-th additional reference (1-based): an upload or a result. */
export function refLabel(t: TFunction, file: string, n: number): string {
  return isUpload(file) ? t('gallery.refUpload', { n }) : t('gallery.refResult', { n });
}

/**
 * What the bottom of "Previous uploads" shows for one upload instead of the footer: the question before deleting it,
 * or the runs that use it (`confirmRun`: the run whose delete is being confirmed).
 */
export type UploadPanel = { file: string; view: 'delete' } | { file: string; view: 'runs'; confirmRun: string | null };

/** Clicking an upload's "used in N runs": show its runs, or hide them when they are shown already. */
export function toggleRuns(panel: UploadPanel | null, file: string): UploadPanel | null {
  return panel?.file === file && panel.view === 'runs' ? null : { file, view: 'runs', confirmRun: null };
}

/** Escape inside the panel: cancels the question about a run first, then closes the panel. */
export function panelAfterEscape(panel: UploadPanel): UploadPanel | null {
  return panel.view === 'runs' && panel.confirmRun ? { ...panel, confirmRun: null } : null;
}

/** The view an upload's tile has open (null: none). */
export function tileView(panel: UploadPanel | null, file: string): UploadPanel['view'] | null {
  return panel?.file === file ? panel.view : null;
}

/** Border tone of an upload's tile: red while its delete is asked, accent while picked or its runs are shown. */
export function tileTone(view: UploadPanel['view'] | null, picked: boolean): 'err' | 'accent' | 'line' {
  if (view === 'delete') return 'err';
  return picked || view === 'runs' ? 'accent' : 'line';
}

/** Text in place of a list that is loading (null), failed to load or is empty. */
export function listStateText(
  state: unknown[] | null | 'failed',
  texts: { loading: string; failed: string; empty: string },
): string {
  if (state === null) return texts.loading;
  return state === 'failed' ? texts.failed : texts.empty;
}
