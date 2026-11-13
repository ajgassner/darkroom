import { toast } from 'sonner';
import i18n from '@/i18n';
import { api, readAsDataUrl } from './api';
import { audioSettingsFrom, extraRefsFrom, imageSettingsFrom } from './reuse';
import { type DEFAULT_SETTINGS, useData, useSettings, useUi } from './store';
import type {
  ElementInfo,
  ImageModel,
  ManifestEntry,
  MusicModel,
  Notice,
  Preset,
  SpeechModel,
  Status,
  UpdateResponse,
  VoiceInfo,
} from './types';
import { MAX_SAMPLE_SEC, toWav } from './wav';

const t = i18n.t.bind(i18n);

/** Text of an error: translated when the server sent a known code, otherwise its message. */
export function errorMessage(err: unknown): string {
  const { code, params } = (err ?? {}) as { code?: unknown; params?: Record<string, unknown> };
  if (typeof code === 'string' && i18n.exists(`error.${code}`)) return tDynamic(`error.${code}`, params);
  return err instanceof Error ? err.message : String(err);
}

/** Translate a key that is only known at runtime (server codes); typed keys use `t` directly. */
const tDynamic = i18n.t as unknown as (key: string, params?: Record<string, unknown>) => string;

/** Translated text of a server error code, falling back to the server's English message. */
export function entryError(e: ManifestEntry): string {
  if (e.errorCode) {
    const key = `error.${e.errorCode}`;
    if (i18n.exists(key)) return tDynamic(key, e.errorParams);
  }
  return e.error ?? 'Error';
}

/** Translated notices of an entry (old entries only have English/German `warnings`). */
export function entryNotices(e: ManifestEntry): string[] {
  if (e.notices?.length) {
    return e.notices.map((n: Notice, i) => {
      const key = `notice.${n.code}`;
      return i18n.exists(key) ? tDynamic(key, n.params) : (e.warnings[i] ?? n.code);
    });
  }
  return e.warnings ?? [];
}

// ---------------------------------------------------------------- Loading

export async function refreshHistory() {
  const [status, history] = await Promise.all([api<Status>('/api/status'), api<ManifestEntry[]>('/api/history')]);
  useData.setState({ status, history });
}

export async function reloadElements() {
  useData.setState({ elements: await api<ElementInfo[]>('/api/elements') });
}

export async function reloadVoices() {
  useData.setState({ voices: await api<VoiceInfo[]>('/api/voices') });
}

/** Store the OpenRouter key entered on first start; the status then lets the app through. */
export async function saveApiKey(key: string) {
  await api<{ ok: true }>('/api/key', { body: { key } });
  useData.setState({ status: await api<Status>('/api/status') });
}

const hadSettings = (() => {
  try {
    return Boolean(localStorage.getItem('darkroom.settings'));
  } catch {
    return false;
  }
})();

/** Initial load. The loading screen stays until the data of the open tab is there. */
export async function loadAll() {
  useUi.setState({ load: { state: 'loading' } });
  const audio = loadAudioData();
  try {
    await loadImageData();
    if (useSettings.getState().mode === 'audio') await audio;
    useUi.setState({ load: { state: 'ready' } });
    // Update hint: in the background, it must never delay or break the start
    api<UpdateResponse>('/api/update')
      .then((r) => useData.setState({ update: r.update }))
      .catch(() => {});
  } catch (err) {
    useUi.setState({ load: { state: 'failed', error: errorMessage(err) } });
  }
}

async function loadImageData() {
  const [status, models, elements, presets, history] = await Promise.all([
    api<Status>('/api/status'),
    api<ImageModel[]>('/api/models'),
    api<ElementInfo[]>('/api/elements'),
    api<Preset[]>('/api/presets'),
    api<ManifestEntry[]>('/api/history'),
  ]);
  useData.setState({ status, models, elements, presets, history });
  const s = useSettings.getState();
  const patch: Partial<typeof DEFAULT_SETTINGS> = {};
  if (!hadSettings) patch.privacy = status.defaultPrivacy;
  const valid = s.models.filter((id) => models.some((m) => m.id === id));
  patch.models = valid.length ? valid : [status.defaultModel];
  if (!s.element && elements.length === 1) patch.element = elements[0].name;
  s.set(patch);
}

/** Audio data is slower; it only blocks the loading screen when the audio tab is open. Errors become a toast. */
async function loadAudioData() {
  try {
    const [speechModels, musicModels, voices] = await Promise.all([
      api<SpeechModel[]>('/api/speech/models'),
      api<MusicModel[]>('/api/music/models'),
      api<VoiceInfo[]>('/api/voices'),
    ]);
    useData.setState({ speechModels, musicModels, voices });
  } catch (err) {
    toast.error(t('toast.audioModelsFailed', { error: errorMessage(err) }));
  }
}

// ---------------------------------------------------------------- Gallery actions

/** Delete files; manifest entries are only marked so the cost total stays correct. */
export async function deleteEntries(
  body: { ids?: string[]; files?: string[]; runId?: string },
  confirmText: string | null,
): Promise<boolean> {
  if (confirmText && !window.confirm(confirmText)) return false;
  try {
    const r = await api<{ entries: number; files: string[] }>('/api/delete', { body });
    const gone = new Set(r.files);
    useUi.setState((s) => ({ extraRefs: s.extraRefs.filter((x) => !(x.kind === 'out' && gone.has(x.outFile))) }));
    await refreshHistory();
    toast.success(r.files.length ? t('toast.deleted', { count: r.files.length }) : t('toast.removed'));
    return true;
  } catch (err) {
    toast.error(errorMessage(err));
    return false;
  }
}

/** Load prompt and settings of an earlier result back into the form. */
export function reuseSettings(e: ManifestEntry) {
  const s = useSettings.getState();
  useUi.setState({ prompt: e.prompt });
  if (e.kind === 'audio') {
    s.set(audioSettingsFrom(e));
    toast.success(t('toast.reusedAudio'));
  } else {
    s.set(imageSettingsFrom(e, s));
    useUi.setState({ extraRefs: extraRefsFrom(e) });
    toast.success(t('toast.reused'));
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function addExtraFiles(files: File[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const dataUrl = await readAsDataUrl(f);
    useUi.setState((s) => ({ extraRefs: [...s.extraRefs, { kind: 'upload', dataUrl, name: f.name }] }));
    n++;
  }
  return n;
}

/** Bring own images into the gallery and open the last one with the tools. */
export async function importImages(files: File[]) {
  let last: ManifestEntry | null = null;
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    try {
      last = await api<ManifestEntry>('/api/import', { body: { filename: f.name, dataUrl: await readAsDataUrl(f) } });
    } catch (err) {
      toast.error(`${f.name}: ${errorMessage(err)}`);
    }
  }
  if (!last) return;
  useSettings.getState().set({ mode: 'image' });
  await refreshHistory();
  useUi.setState({ lightbox: last });
  toast.success(t('toast.imported'));
}

// ---------------------------------------------------------------- Elements

export async function uploadPhotos(name: string, files: File[]) {
  let n = 0;
  for (const f of files) {
    try {
      await api(`/api/elements/${encodeURIComponent(name)}/photos`, {
        body: { filename: f.name, dataUrl: await readAsDataUrl(f) },
      });
      n++;
    } catch (err) {
      toast.error(`${f.name}: ${errorMessage(err)}`);
    }
  }
  await reloadElements();
  if (n) toast.success(t('toast.photosAdded', { count: n }));
}

// ---------------------------------------------------------------- Voices

export function transcribeSettings() {
  const s = useSettings.getState();
  return {
    engine: s.transcribeEngine || useData.getState().status?.transcribe.engine || 'local',
    language: s.transcribeLang || 'de',
  };
}

export async function transcribe(name: string, file: string) {
  const key = `${name}/${file}`;
  useUi.setState((s) => ({ transcribing: [...s.transcribing, key] }));
  try {
    const { engine, language } = transcribeSettings();
    const r = await api<{ text: string }>(
      `/api/voices/${encodeURIComponent(name)}/samples/${encodeURIComponent(file)}/transcribe`,
      { body: { engine, language, privacy: useSettings.getState().privacy } },
    );
    if (!r.text) toast.error(t('toast.noSpeechRecognized'));
  } catch (err) {
    toast.error(errorMessage(err));
  } finally {
    useUi.setState((s) => ({ transcribing: s.transcribing.filter((k) => k !== key) }));
    await reloadVoices();
  }
}

/** Convert one audio file to WAV in the browser and upload it; returns the stored file name, or null on error. */
async function uploadSample(name: string, f: File): Promise<string | null> {
  const label = f.name || 'recording';
  try {
    const { blob, seconds, truncated } = await toWav(await f.arrayBuffer());
    const r = await api<{ file: string }>(`/api/voices/${encodeURIComponent(name)}/samples`, {
      body: { filename: label, dataUrl: await readAsDataUrl(blob) },
    });
    if (truncated) toast(t('toast.sampleTruncated', { name: f.name, sec: MAX_SAMPLE_SEC }));
    else if (seconds < 5) toast.warning(t('toast.sampleShort', { name: f.name, sec: seconds.toFixed(1) }));
    return r.file;
  } catch (err) {
    toast.error(`${label}: ${errorMessage(err)}`);
    return null;
  }
}

/** Upload audio files as samples of a voice, then transcribe each new sample. */
export async function uploadSamples(name: string, files: File[]) {
  const added: string[] = [];
  for (const f of files) {
    const file = await uploadSample(name, f);
    if (file) added.push(file);
  }
  await reloadVoices();
  if (added.length) toast.success(t('toast.samplesSaved', { count: added.length }));
  for (const file of added) await transcribe(name, file);
}
