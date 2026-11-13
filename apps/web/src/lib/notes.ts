// Which notes/warnings the side panels show for the current settings. Pure: returns translation keys
// (below `notes.`) with their params, the panels translate and render them.
import type { en } from '@/i18n/en';
import { activeElements, promptMentions } from './mentions';
import { allowedByPrivacy, enumVals, maxRefs, nearestAspect, nearestSize } from './models';
import type { Settings } from './store';
import type { ElementInfo, ImageModel, MusicModel, SpeechModel, Status, VoiceInfo } from './types';
import { pricePerThousandChars } from './voices';

export type NoteKey = Exclude<keyof (typeof en)['notes'], 'title'>;
export type NoteTone = '' | 'warn' | 'err';
export interface Note {
  tone: NoteTone;
  key: NoteKey;
  params?: Record<string, string | number>;
}

type StatusLike = Pick<Status, 'hasKey'> | null | undefined;

function keyNotes(status: StatusLike): Note[] {
  return status && !status.hasKey ? [{ tone: 'err', key: 'keyMissing' }] : [];
}

// ---------------------------------------------------------------- Image

export interface ImageNotesInput {
  status: StatusLike;
  settings: Pick<Settings, 'models' | 'element' | 'privacy' | 'aspect' | 'size' | 'format'>;
  models: ImageModel[];
  elements: ElementInfo[];
  prompt: string;
  extraRefCount: number;
  modelName: (id: string) => string;
}

export function imageNotes(input: ImageNotesInput): Note[] {
  const { settings: s, prompt, elements } = input;
  const selected = input.models.filter((m) => s.models.includes(m.id));
  const active = activeElements(prompt, elements, s.element);
  const refTotal = input.extraRefCount + active.reduce((n, e) => n + e.photos.length, 0);
  return [
    ...keyNotes(input.status),
    ...selectionNotes(selected, active, promptMentions(prompt, elements).unknown),
    ...selected.flatMap((m) => modelNotes(m, input.modelName(m.id), s, refTotal)),
  ];
}

function selectionNotes(selected: ImageModel[], active: ElementInfo[], unknownMentions: string[]): Note[] {
  const notes: Note[] = [];
  if (!selected.length) notes.push({ tone: 'err', key: 'noModel' });
  if (!active.length) notes.push({ tone: 'warn', key: 'noElement' });
  for (const e of active) {
    if (!e.photos.length) notes.push({ tone: 'err', key: 'elementNoPhotos', params: { name: e.name } });
  }
  for (const name of unknownMentions) notes.push({ tone: 'warn', key: 'unknownMention', params: { name } });
  return notes;
}

/** Notes for one selected model: blocked by privacy, or which settings it can't follow. */
function modelNotes(m: ImageModel, model: string, s: ImageNotesInput['settings'], refTotal: number): Note[] {
  if (!allowedByPrivacy(m.zdr, s.privacy)) return [{ tone: 'err', key: 'blocked', params: { model } }];
  return [
    refsNote(m, model, refTotal),
    aspectNote(m, model, s.aspect),
    sizeNote(m, model, s.size),
    formatNote(m, model, s.format),
  ].filter((n): n is Note => n !== null);
}

function refsNote(m: ImageModel, model: string, refTotal: number): Note | null {
  const max = maxRefs(m);
  if (refTotal <= max) return null;
  return { tone: 'warn', key: 'refsOver', params: { model, max, count: refTotal - max } };
}

function aspectNote(m: ImageModel, model: string, aspect: string): Note | null {
  const supported = enumVals(m, 'aspect_ratio');
  if (!aspect || !supported || supported.includes(aspect)) return null;
  return {
    tone: '',
    key: 'aspectAdjusted',
    params: { model, from: aspect, to: nearestAspect(supported, aspect) ?? '?' },
  };
}

function sizeNote(m: ImageModel, model: string, size: string): Note | null {
  if (!size) return null;
  const supported = enumVals(m, 'resolution');
  if (!supported) return { tone: '', key: 'sizeUnsupported', params: { model } };
  if (supported.includes(size)) return null;
  return { tone: '', key: 'sizeAdjusted', params: { model, from: size, to: nearestSize(supported, size) ?? '?' } };
}

function formatNote(m: ImageModel, model: string, format: string): Note | null {
  if (!format || enumVals(m, 'output_format')?.includes(format)) return null;
  return { tone: '', key: 'formatUnsupported', params: { model } };
}

// ---------------------------------------------------------------- Audio

export interface AudioNotesInput {
  status: StatusLike;
  settings: Pick<Settings, 'audioKind' | 'speechModel' | 'musicModel' | 'privacy' | 'voice' | 'instructions'>;
  speechModels: SpeechModel[];
  musicModels: MusicModel[];
  voices: VoiceInfo[];
}

/** Providers whose speech models follow free-text instructions. */
const INSTRUCTION_PROVIDERS = /^(google|fish-audio|openai)\//;

export function audioNotes(input: AudioNotesInput): Note[] {
  const kindNotes = input.settings.audioKind === 'speech' ? speechNotes(input) : musicNotes(input);
  return [...keyNotes(input.status), ...kindNotes];
}

function speechNotes({ settings: s, speechModels, voices }: AudioNotesInput): Note[] {
  const m = speechModels.find((x) => x.id === s.speechModel);
  if (!m) return [{ tone: 'err', key: 'speechModelMissing' }];
  const notes: Note[] = [];
  if (!allowedByPrivacy(m.zdr, s.privacy)) notes.push({ tone: 'err', key: 'modelBlocked' });
  if (m.pricing?.prompt) {
    notes.push({ tone: '', key: 'speechPrice', params: { price: pricePerThousandChars(m.pricing.prompt) } });
  }
  notes.push(...ownVoiceNotes(s.voice, voices));
  if (!m.cloning && voices.length) notes.push({ tone: '', key: 'cloningOnly' });
  if (s.instructions && !INSTRUCTION_PROVIDERS.test(m.id)) notes.push({ tone: '', key: 'instructionsIgnored' });
  return notes;
}

function ownVoiceNotes(voice: string, voices: VoiceInfo[]): Note[] {
  const v = voice.startsWith('voice:') ? voices.find((x) => `voice:${x.name}` === voice) : undefined;
  if (!v) return [];
  const notes: Note[] = [];
  if (!v.samples.length) notes.push({ tone: 'err', key: 'voiceNoSample', params: { label: v.label } });
  if (!v.transcript.trim()) notes.push({ tone: 'warn', key: 'transcriptTip' });
  return notes;
}

function musicNotes({ settings: s, musicModels }: AudioNotesInput): Note[] {
  const m = musicModels.find((x) => x.id === s.musicModel);
  if (!m) return [{ tone: 'err', key: 'musicMissing' }];
  if (!m.zdr.length && s.privacy !== 'off') return [{ tone: 'warn', key: 'musicNoZdr' }];
  return [];
}
