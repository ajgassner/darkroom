import type { ElementInfo } from './types';

/** @name mentions; the lookbehind-like prefix group avoids matching e-mail addresses. */
const MENTION_RE = /(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/g;

export function promptMentions(text: string, elements: ElementInfo[]): { known: ElementInfo[]; unknown: string[] } {
  const known: ElementInfo[] = [];
  const unknown: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const el = elements.find((e) => e.name.toLowerCase() === m[2].toLowerCase());
    if (el) {
      if (!known.includes(el)) known.push(el);
    } else if (!unknown.includes(m[2])) unknown.push(m[2]);
  }
  return { known, unknown };
}

/** All elements that will be sent: dropdown element + mentions (same rule as the server). */
export function activeElements(text: string, elements: ElementInfo[], selected: string): ElementInfo[] {
  const list: ElementInfo[] = [];
  const sel = elements.find((e) => e.name === selected);
  if (sel) list.push(sel);
  for (const e of promptMentions(text, elements).known) if (!list.includes(e)) list.push(e);
  return list;
}

/** An unfinished "@word" directly before the caret (not part of an e-mail address). */
export function mentionQuery(text: string, caret: number): { query: string; start: number; end: number } | null {
  const m = /(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1, end: caret };
}

export type MentionKeyAction = 'next' | 'previous' | 'pick' | 'close';

/** What a key does while the mention suggestions are open (null: the key is not handled). */
export function mentionKeyAction(e: { key: string; metaKey?: boolean; ctrlKey?: boolean }): MentionKeyAction | null {
  switch (e.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Tab':
      return 'pick';
    case 'Enter':
      // Cmd/Ctrl+Enter generates instead
      return e.metaKey || e.ctrlKey ? null : 'pick';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}
