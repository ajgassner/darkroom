// Parsing of CLI arguments (kept separate from the commands so it can be tested).
import fs from 'node:fs';
import path from 'node:path';
import type { ExtraRef } from '@darkroom/core/generate';

/** Commander parser for repeatable options: `-m a -m b` gives ['a', 'b']. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Models from repeated and/or comma-separated -m values, without duplicates. */
export function parseModels(values: string[]): string[] {
  const ids = values.flatMap((v) => v.split(',')).map((m) => m.trim());
  return [...new Set(ids.filter(Boolean))];
}

/** Additional references: a path on disk or a file name below out/. */
export function resolveRefs(refs: string[] | undefined, outDir: string): ExtraRef[] {
  return (refs ?? []).map((r) => {
    if (fs.existsSync(r)) return { path: path.resolve(r) };
    if (fs.existsSync(path.join(outDir, r))) return { outFile: r };
    throw new Error(`Reference not found: ${r}`);
  });
}

/** Whether the prompt already names elements with @mentions. */
export function hasMention(prompt: string): boolean {
  return /@\w/.test(prompt);
}
