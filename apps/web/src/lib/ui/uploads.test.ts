import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { ExtraRef } from '../store';
import {
  deleteLabel,
  hasOutRef,
  isUpload,
  listStateText,
  panelAfterEscape,
  pickLabel,
  refLabel,
  runRefThumbs,
  storedUploads,
  tileTone,
  tileView,
  toggleOutRef,
  toggleRuns,
  type UploadPanel,
  uploadName,
  usageText,
  withOutRef,
  withoutOutRefs,
} from './uploads';

/** Returns the key, followed by the param values: "uploads.usedIn:2". */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join('/')}` : key) as unknown as TFunction;

const U = 'uploads/0123456789abcdef.jpg';
const pasted: ExtraRef = { kind: 'upload', dataUrl: 'data:image/png;base64,AA', name: U };
const result: ExtraRef = { kind: 'out', outFile: 'a.png' };

describe('previous uploads as references', () => {
  it('names the file inside out/uploads/', () => {
    expect(uploadName(U)).toBe('0123456789abcdef.jpg');
  });

  it('adds a file from out/ only once (a pasted image with the same name does not count)', () => {
    const once = withOutRef([pasted, result], U);
    expect(once).toEqual([pasted, result, { kind: 'out', outFile: U }]);
    expect(withOutRef(once, U)).toBe(once);
    expect(hasOutRef([pasted], U)).toBe(false);
  });

  it('toggles a pick', () => {
    const picked = toggleOutRef([result], U);
    expect(picked).toEqual([result, { kind: 'out', outFile: U }]);
    expect(toggleOutRef(picked, U)).toEqual([result]);
  });

  it('drops deleted files and keeps the list when nothing goes', () => {
    const refs = [pasted, result, { kind: 'out', outFile: U } as ExtraRef];
    expect(withoutOutRefs(refs, [U, 'a.png'])).toEqual([pasted]);
    expect(withoutOutRefs(refs, ['other.png'])).toBe(refs);
    expect(withoutOutRefs(refs, [])).toBe(refs);
  });

  it('refers to new uploads by their stored file once a run stored them', () => {
    const other: ExtraRef = { kind: 'upload', dataUrl: 'data:image/png;base64,BB', name: 'b.png' };
    const sent = [pasted, result, other];
    const stored = [U, 'a.png', 'uploads/fedcba9876543210.jpg'];
    // `other` was removed meanwhile, another image was added: only the pasted one still in the list changes
    const later: ExtraRef = { kind: 'upload', dataUrl: 'data:image/png;base64,CC', name: 'c.png' };
    expect(storedUploads([pasted, result, later], sent, stored)).toEqual([{ kind: 'out', outFile: U }, result, later]);
    // Already picked under "Previous uploads": the pasted copy goes
    expect(storedUploads([{ kind: 'out', outFile: U }, pasted], [pasted], [U])).toEqual([{ kind: 'out', outFile: U }]);
    // Refs of a run that does not match what was sent stay as they are
    const refs = [pasted];
    expect(storedUploads(refs, [pasted], [])).toBe(refs);
    expect(storedUploads(refs, [pasted], ['a.png'])).toEqual([pasted]);
  });

  it('describes how an upload is used', () => {
    expect(usageText(t, { runs: 0 })).toBe('uploads.unused');
    expect(usageText(t, { runs: 2 })).toBe('uploads.usedIn:2');
    expect(pickLabel(t, { runs: 1 }, false)).toBe('uploads.pick:uploads.usedIn:1');
    expect(pickLabel(t, { runs: 0 }, true)).toBe('uploads.unpick:uploads.unused');
    expect(deleteLabel(t, { runs: 0 })).toBe('uploads.delete');
    expect(deleteLabel(t, { runs: 3 })).toBe('uploads.deleteLocked:3');
  });

  it('shows at most four references of a run, counting the rest', () => {
    expect(runRefThumbs(undefined)).toEqual({ shown: [], more: 0 });
    expect(runRefThumbs(['a.png', U])).toEqual({ shown: ['a.png', U], more: 0 });
    const six = ['1.png', '2.png', '3.png', '4.png', '5.png', U];
    expect(runRefThumbs(six)).toEqual({ shown: six.slice(0, 4), more: 2 });
    expect(runRefThumbs(six, 2)).toEqual({ shown: six.slice(0, 2), more: 4 });
  });

  it('names references by where they come from', () => {
    expect(isUpload(U)).toBe(true);
    expect(isUpload('2026-01-01/uploads.png')).toBe(false);
    expect(refLabel(t, U, 1)).toBe('gallery.refUpload:1');
    expect(refLabel(t, 'a.png', 2)).toBe('gallery.refResult:2');
  });

  it('opens and closes the panels of an upload', () => {
    const runs: UploadPanel = { file: U, view: 'runs', confirmRun: null };
    expect(toggleRuns(null, U)).toEqual(runs);
    expect(toggleRuns(runs, U)).toBeNull();
    expect(toggleRuns({ file: U, view: 'delete' }, U)).toEqual(runs);
    expect(toggleRuns(runs, 'uploads/x.jpg')).toEqual({ file: 'uploads/x.jpg', view: 'runs', confirmRun: null });
    // Escape cancels the question about a run first, then closes the panel
    expect(panelAfterEscape({ ...runs, confirmRun: 'r1' })).toEqual(runs);
    expect(panelAfterEscape(runs)).toBeNull();
    expect(panelAfterEscape({ file: U, view: 'delete' })).toBeNull();
    expect(tileView(runs, U)).toBe('runs');
    expect(tileView(runs, 'a.png')).toBeNull();
    expect(tileView(null, U)).toBeNull();
  });

  it('marks the tile of a picked upload or one with an open panel', () => {
    expect(tileTone('delete', true)).toBe('err');
    expect(tileTone('runs', false)).toBe('accent');
    expect(tileTone(null, true)).toBe('accent');
    expect(tileTone(null, false)).toBe('line');
  });

  it('says why a list is empty', () => {
    const texts = { loading: 'L', failed: 'F', empty: 'E' };
    expect(listStateText(null, texts)).toBe('L');
    expect(listStateText('failed', texts)).toBe('F');
    expect(listStateText([], texts)).toBe('E');
  });
});
