// Parsing of CLI arguments (kept separate from the commands so it can be tested).
import fs from 'node:fs';
import path from 'node:path';
import type { ExtraRef } from '@darkroom/core/generate';
import { InvalidArgumentError } from 'commander';

/** Commander parser for repeatable options: `-m a -m b` gives ['a', 'b']. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Models from repeated and/or comma-separated -m values, without duplicates. */
export function parseModels(values: string[]): string[] {
  const ids = values.flatMap((v) => v.split(',')).map((m) => m.trim());
  return [...new Set(ids.filter(Boolean))];
}

/** The part of `file` below `dir`, or null when it is not inside. */
function inside(dir: string, file: string): string | null {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

/**
 * Additional references: a file below out/ (as a name, as "out/<name>" like older results were printed,
 * or as a path into it) or any other image on disk.
 */
export function resolveRefs(refs: string[] | undefined, outDir: string): ExtraRef[] {
  return (refs ?? []).map((r) => {
    const onDisk = fs.existsSync(r) ? path.resolve(r) : null;
    const below = onDisk && inside(outDir, onDisk);
    if (below) return { outFile: below.split(path.sep).join('/') };
    if (onDisk) return { path: onDisk };
    for (const name of [r, r.replace(/^out[\\/]/, '')]) {
      if (inside(outDir, path.resolve(outDir, name)) && fs.existsSync(path.join(outDir, name)))
        return { outFile: name };
    }
    throw new Error(`Reference not found: ${r}`);
  });
}

/** How to show a result file: relative to the working directory when that is shorter, otherwise absolute. */
export function displayPath(file: string, cwd: string): string {
  const rel = inside(cwd, file);
  return rel && rel.length < file.length ? rel : file;
}

/** Commander parser for an integer option within a range. */
export function intArg(min: number, max: number) {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new InvalidArgumentError(`must be an integer from ${min} to ${max}`);
    return n;
  };
}

/** Commander parser for a decimal option within a range. */
export function floatArg(min: number, max: number) {
  return (v: string) => {
    const n = Number(v);
    if (!v.trim() || !Number.isFinite(n) || n < min || n > max)
      throw new InvalidArgumentError(`must be a number from ${min} to ${max}`);
    return n;
  };
}

/** The options the user gave on the command line (not their defaults), so the interactive mode does not ask them. */
export function explicitOptions<T extends object>(
  values: T,
  sourceOf: (option: string) => string | undefined,
  options: Partial<Record<keyof T, string>>,
): Partial<T> {
  const given = Object.entries(options).filter(([, option]) => sourceOf(option as string) === 'cli');
  return Object.fromEntries(given.map(([key]) => [key, values[key as keyof T]])) as Partial<T>;
}

/** Whether the prompt already names elements with @mentions. */
export function hasMention(prompt: string): boolean {
  return /@\w/.test(prompt);
}
