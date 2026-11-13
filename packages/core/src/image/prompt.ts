// Building the final prompt: which reference image belongs to which element, plus the rules per element type.
import type { ElementInfo } from '../contract.ts';
import { isTemplate, replaceMentions, TYPE_RULES } from '../elements/refs.ts';

/** An element with the number of its reference images actually sent. */
export interface ElementGroup {
  info: ElementInfo;
  count: number;
}

const TYPE_NAMES: Record<string, string> = {
  person: 'person',
  logo: 'logo',
  object: 'object/product',
  location: 'location',
  style: 'style reference',
};

/** Nouns for elements that are referred to by image number instead of by name. */
const REF_NOUN: Record<string, string> = { logo: 'logo', object: 'object', location: 'location', style: 'style' };

const EXTRA_LINE =
  'additional reference (for example an image to keep editing, or a reference for outfit, place or style).';

function rangeText(from: number, to: number): string {
  return from === to ? `${from}` : `${from}-${to}`;
}

/** "image 3" or "images 3-4", numbered after the additional references. */
function imageRanges(used: ElementGroup[], extraCount: number): Map<string, string> {
  const ranges = new Map<string, string>();
  let idx = extraCount + 1;
  for (const g of used) {
    ranges.set(g.info.name, `${g.count > 1 ? 'images' : 'image'} ${rangeText(idx, idx + g.count - 1)}`);
    idx += g.count;
  }
  return ranges;
}

/**
 * Replacement for each @name: people by their name, everything else by image number
 * (otherwise models like to write the element name as text into the image).
 */
function mentionLabels(groups: ElementGroup[], ranges: Map<string, string>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { info } of groups) {
    const range = ranges.get(info.name);
    const noun = REF_NOUN[info.type];
    labels.set(info.name.toLowerCase(), range && noun ? `[${noun}, reference ${range}]` : info.label);
  }
  return labels;
}

function referenceWord(count: number): string {
  return count > 1 ? 'Reference images' : 'Reference image';
}

/**
 * Replace {label} and {prompt} in an instruction text in one pass. A replacer function inserts user text
 * literally (a replacement string would interpret `$&`, `$$` and the like).
 */
function fillTemplate(text: string, values: { label: string; prompt?: string }): string {
  return text.replace(/\{(label|prompt)\}/g, (all, key: 'label' | 'prompt') => values[key] ?? all);
}

/** Previous behavior: exactly one person with an instruction template ({prompt}, {label}). */
function templatePrompt(group: ElementGroup, extraCount: number, task: string): string {
  const el = group.info;
  const lines: string[] = [];
  if (extraCount > 0) {
    lines.push(
      `${referenceWord(extraCount)} ${rangeText(1, extraCount)}: ${EXTRA_LINE}`,
      `${referenceWord(group.count)} ${rangeText(extraCount + 1, extraCount + group.count)}: identity reference${group.count > 1 ? 's' : ''} of ${el.label}.`,
      '',
    );
  }
  lines.push(fillTemplate(el.instructions, { label: el.label, prompt: task }));
  return lines.join('\n');
}

function extraLines(extraCount: number, editMode: boolean): string[] {
  if (editMode) {
    return [
      'Edit reference image 1 (the image to edit) as described below.',
      ...(extraCount > 1 ? [`Reference images ${rangeText(2, extraCount)}: additional references.`] : []),
    ];
  }
  return extraCount > 0 ? [`${referenceWord(extraCount)} ${rangeText(1, extraCount)}: ${EXTRA_LINE}`] : [];
}

/** "Reference images 2-3: Max, a person. <type rule> <custom instruction>" */
function elementLine(el: ElementInfo, range: string): string {
  const who = el.type === 'person' ? `${el.label}, a person` : `a ${TYPE_NAMES[el.type] ?? el.type}`;
  const custom =
    el.instructions && !isTemplate(el.instructions)
      ? ` ${fillTemplate(el.instructions, { label: el.label }).trim()}`
      : '';
  return `Reference ${range}: ${who}. ${TYPE_RULES[el.type]}${custom}`;
}

/**
 * Build the prompt with the mapping of reference images.
 * - Without prefix (and not editing) only the @mentions are replaced.
 * - A single person element with a template ({prompt}) uses exactly that template.
 * - Otherwise: one line per element plus general rules, then the task.
 */
export function composePrompt(
  userPrompt: string,
  groups: ElementGroup[],
  extraCount: number,
  usePrefix: boolean,
  editMode: boolean,
): string {
  const used = groups.filter((g) => g.count > 0);
  const ranges = imageRanges(used, extraCount);
  const task = replaceMentions(userPrompt, mentionLabels(groups, ranges));
  if (!usePrefix && !editMode) return task;

  const single = used.length === 1 ? used[0] : null;
  if (!editMode && single?.info.type === 'person' && isTemplate(single.info.instructions)) {
    return templatePrompt(single, extraCount, task);
  }
  if (!used.length && !extraCount && !editMode) return task;

  const lines = [
    ...extraLines(extraCount, editMode),
    ...used.map((g) => elementLine(g.info, ranges.get(g.info.name) ?? '')),
    'Do not write element names, @handles or reference numbers as text in the image.',
  ];
  if (!editMode && used.some((g) => g.info.type === 'person')) {
    lines.push(
      'Unless the task says otherwise, create a photorealistic photograph with natural skin texture and realistic lighting.',
    );
  }
  lines.push('', editMode ? task : `Task: ${task}`);
  return lines.join('\n');
}
