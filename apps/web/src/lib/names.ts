// Folder names of new elements and voices, derived from the display name the user types.

const SPELLED_OUT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/**
 * Folder name for a display name: lowercase, umlauts spelled out (ä → ae, ß → ss), other accents dropped, every
 * other run of characters becomes one '-', no '-' at the ends, at most 64 characters. The result is either empty or
 * a name the server accepts (letters, digits, _ - and no leading dot) and that works as an @mention.
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => SPELLED_OUT[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

export type FolderName = { name: string; error: 'empty' | 'taken' | null };

/** Folder name for a new item and why it can't be used: nothing usable typed, or already taken (ignoring case). */
export function folderName(label: string, existing: string[]): FolderName {
  const name = slugify(label);
  if (!name) return { name, error: 'empty' };
  if (existing.some((e) => e.toLowerCase() === name)) return { name, error: 'taken' };
  return { name, error: null };
}

export interface NewItem {
  /** Display name as typed (trimmed) */
  label: string;
  /** Folder name derived from it */
  name: string;
  /** Can be created */
  ok: boolean;
  /** Hint below the name field (null while nothing is typed): the folder that will be used, or the problem */
  hint: { key: 'newItem.folder' | 'newItem.empty' | 'newItem.taken'; invalid: boolean } | null;
}

/** State of the "create" field of the elements and voices dialogs for the typed text. */
export function newItem(input: string, existing: string[]): NewItem {
  const label = input.trim();
  if (!label) return { label, name: '', ok: false, hint: null };
  const { name, error } = folderName(label, existing);
  if (error) return { label, name, ok: false, hint: { key: `newItem.${error}`, invalid: true } };
  return { label, name, ok: true, hint: { key: 'newItem.folder', invalid: false } };
}

/** Item to select after deleting one from a list: the next one, else the previous one, else none. */
export function selectionAfterDelete(keys: string[], deleted: string): string | null {
  const index = keys.indexOf(deleted);
  const rest = keys.filter((k) => k !== deleted);
  if (!rest.length) return null;
  return rest[Math.min(Math.max(index, 0), rest.length - 1)];
}
