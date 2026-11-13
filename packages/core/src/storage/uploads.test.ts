import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUT_DIR, UPLOADS_DIR } from '../config.ts';
import type { ManifestEntry } from '../contract.ts';
import { deleteUpload, entryUploads, existingUpload, listUploads, removeUploads } from './uploads.ts';

const A = '0123456789abcdef.jpg';
const B = 'fedcba9876543210.jpg';

const entry = (runId: string, extraRefs: string[], deleted?: string) =>
  ({ runId, extraRefs, deleted }) as ManifestEntry;

/** An upload of `size` bytes, last modified at second `size` (so a larger one is newer). */
async function write(name: string, size: number) {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const file = path.join(UPLOADS_DIR, name);
  await fs.writeFile(file, 'x'.repeat(size));
  await fs.utimes(file, size, size);
}

describe('uploads', () => {
  it('reads the uploads among the extra references', () => {
    expect(entryUploads({ extraRefs: [`uploads/${A}`, 'a.png', 'uploads/x.jpg', `uploads/${B}/..`] })).toEqual([A]);
    expect(entryUploads({} as ManifestEntry)).toEqual([]);
  });

  it('lists nothing without the folder', async () => {
    expect(await listUploads([])).toEqual([]);
  });

  it('lists uploads newest first with the runs that use them, skipping other files', async () => {
    await write(A, 1000);
    await write(B, 2000);
    await fs.writeFile(path.join(UPLOADS_DIR, 'notes.txt'), 'x');
    await fs.writeFile(path.join(UPLOADS_DIR, `${A}.123-abcd.tmp`), 'x');
    await fs.mkdir(path.join(UPLOADS_DIR, 'aaaaaaaaaaaaaaaa.jpg'), { recursive: true });
    const entries = [
      entry('r1', [`uploads/${A}`]),
      entry('r1', [`uploads/${A}`]),
      entry('r2', [`uploads/${A}`, `uploads/${B}`]),
      entry('r3', [`uploads/${B}`], 'deleted'),
    ];
    expect(await listUploads(entries)).toEqual([
      { file: `uploads/${B}`, size: 2000, mtime: new Date(2_000_000).toISOString(), runs: 1 },
      { file: `uploads/${A}`, size: 1000, mtime: new Date(1_000_000).toISOString(), runs: 2 },
    ]);
  });

  it('deletes only valid upload names inside the uploads folder', async () => {
    await fs.writeFile(path.join(OUT_DIR, 'keep.jpg'), 'x');
    for (const name of ['../keep.jpg', 'keep.jpg', '..', `${A}/../../keep.jpg`, 'ABCDEF0123456789.jpg']) {
      await expect(deleteUpload(name)).rejects.toMatchObject({ code: 'invalid_upload' });
    }
    await expect(existingUpload('aaaaaaaaaaaaaaaa.jpg')).rejects.toMatchObject({ code: 'upload_not_found' });
    await expect(deleteUpload('1111111111111111.jpg')).rejects.toMatchObject({ code: 'upload_not_found' });
    await deleteUpload(A);
    await expect(fs.stat(path.join(UPLOADS_DIR, A))).rejects.toThrow();
    expect(await removeUploads([B, '../keep.jpg', A])).toEqual([`uploads/${B}`]);
    expect(await fs.readFile(path.join(OUT_DIR, 'keep.jpg'), 'utf8')).toBe('x');
  });
});
