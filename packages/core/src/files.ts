// Naming of result and upload files.
import path from 'node:path';

/** Timestamp for file names, e.g. 2026-11-12T18-30-00. */
export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Model IDs and voice names as part of a file name: google/gemini-3 → google_gemini-3. */
export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9.-]+/g, '_');
}

/** Readable base name of an uploaded file: "IMG 0001.HEIC" → "IMG_0001" (max. 40 characters). */
export function safeBaseName(original: string, fallback: string): string {
  return (
    path
      .parse(original)
      .name.replace(/[^A-Za-z0-9_-]+/g, '_')
      .slice(0, 40) || fallback
  );
}
