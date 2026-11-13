import { toast } from 'sonner';
import i18n from '@/i18n';
import { entryError, refreshHistory, toastError } from './actions';
import { streamEvents } from './api';
import { allowedByPrivacy } from './models/models';
import { type LiveFirst, type LiveRun, type Settings, updateLiveRun, useData, useSettings, useUi } from './store';
import { usd } from './text/format';
import { existingElement } from './text/mentions';
import type { ManifestEntry, RunEvent } from './types';
import { revealGallery } from './ui/scroll';

const t = i18n.t.bind(i18n);
let runCounter = 0;

/**
 * Start one run (several can run at the same time). Shows a live card with placeholders, streams results,
 * and can be cancelled; cancelling also aborts the upstream calls on the server.
 */
async function startRun(url: string, body: unknown, plan: LiveRun['plan'], first: LiveFirst) {
  const ctrl = new AbortController();
  const key = `run-${++runCounter}`;
  const run: LiveRun = {
    key,
    first,
    plan,
    entries: [],
    startedAt: Date.now(),
    cancelling: false,
    cancel: () => {
      updateLiveRun(key, { cancelling: true });
      ctrl.abort();
    },
  };
  useUi.setState((s) => ({ liveRuns: [run, ...s.liveRuns] }));
  revealGallery();

  const entries: ManifestEntry[] = [];
  try {
    await streamEvents(
      url,
      body,
      (ev) => {
        switch (ev.type) {
          case 'start':
            updateLiveRun(key, { runId: ev.runId });
            break;
          case 'image':
          case 'error':
            entries.push(ev.entry);
            updateLiveRun(key, (r) => ({ entries: [...r.entries, ev.entry] }));
            break;
          case 'done':
            announceDone(ev, first.kind, entries);
        }
      },
      ctrl.signal,
    );
  } catch (err) {
    if (ctrl.signal.aborted) toast(t('toast.aborted'));
    else toastError(err);
  } finally {
    useUi.setState((s) => ({ liveRuns: s.liveRuns.filter((r) => r.key !== key) }));
    await refreshHistory().catch(() => {});
    // Cancelled runs are written to the manifest shortly after; speech cost arrives a few seconds later
    if (ctrl.signal.aborted) setTimeout(() => void refreshHistory().catch(() => {}), 1500);
    if (first.kind === 'audio') setTimeout(() => void refreshHistory().catch(() => {}), 12_000);
  }
}

type DoneEvent = Extract<RunEvent, { type: 'done' }>;

/** Toast at the end of a run: what was made (with cost and failures), or why nothing was. */
function announceDone(ev: DoneEvent, kind: LiveFirst['kind'], entries: ManifestEntry[]) {
  if (!ev.images) {
    const failed = entries.find((e) => !e.ok);
    toast.error(t('toast.failed', { error: failed ? entryError(failed) : '?' }));
    return;
  }
  const what = kind === 'audio' ? t('toast.audioDone') : t('toast.imagesDone', { count: ev.images });
  const cost = ev.cost ? t('toast.withCost', { cost: usd(ev.cost) }) : '';
  const failed = ev.failed ? t('toast.withFailed', { count: ev.failed }) : '';
  toast.success(`${what}${cost}${failed}`);
}

function generateImage() {
  const s = useSettings.getState();
  const { models: all, elements } = useData.getState();
  const { prompt: rawPrompt, extraRefs } = useUi.getState();
  const prompt = rawPrompt.trim();
  if (!prompt) return toast.error(t('toast.promptMissing'));
  const models = s.models.filter((id) => {
    const m = all.find((x) => x.id === id);
    return m && allowedByPrivacy(m.zdr, s.privacy);
  });
  if (!models.length) return toast.error(t('toast.noModelAvailable'));
  const element = existingElement(s.element, elements);
  void startRun(
    '/api/generate',
    {
      prompt,
      models,
      element: element || null,
      usePrefix: s.usePrefix,
      count: s.count,
      aspectRatio: s.aspect,
      resolution: s.size,
      quality: s.quality,
      outputFormat: s.format,
      privacy: s.privacy,
      extraRefs: extraRefs.map((r) =>
        r.kind === 'out' ? { outFile: r.outFile } : { dataUrl: r.dataUrl, name: r.name },
      ),
    },
    models.map((model) => ({ model, count: s.count })),
    { kind: 'image', prompt, element, params: { aspect_ratio: s.aspect, resolution: s.size } },
  );
}

function generateMusic(s: Settings, prompt: string) {
  if (!s.musicModel) return toast.error(t('toast.noMusicModel'));
  void startRun(
    '/api/music',
    { prompt, model: s.musicModel, privacy: s.privacy },
    [{ model: s.musicModel, count: 1 }],
    { kind: 'audio', prompt, params: { mode: 'music' } },
  );
}

function generateSpeech(s: Settings, text: string) {
  if (!s.speechModel) return toast.error(t('toast.noSpeechModel'));
  void startRun(
    '/api/speech',
    {
      text,
      model: s.speechModel,
      voice: s.voice || undefined,
      instructions: s.instructions || undefined,
      speed: s.speed,
      privacy: s.privacy,
    },
    [{ model: s.speechModel, count: 1 }],
    { kind: 'audio', prompt: text, voice: s.voice, params: {} },
  );
}

function generateAudio() {
  const s = useSettings.getState();
  const text = useUi.getState().prompt.trim();
  const music = s.audioKind === 'music';
  if (!text) return toast.error(t(music ? 'toast.describeMusic' : 'toast.textMissing'));
  if (music) generateMusic(s, text);
  else generateSpeech(s, text);
}

export function generate() {
  if (useSettings.getState().mode === 'audio') generateAudio();
  else generateImage();
}

/** Apply a tool to an image (from the lightbox). */
export function runTool(
  body: { tool: string; source: string; model?: string; element?: string | null; options: Record<string, string> },
  label: string,
) {
  const local =
    body.tool === 'removebg'
      ? 'local/background-removal'
      : ['crop', 'resize'].includes(body.tool)
        ? 'local/sharp'
        : null;
  void startRun(
    '/api/tool',
    { ...body, privacy: useSettings.getState().privacy },
    [{ model: local ?? body.model ?? '', count: 1 }],
    { kind: 'image', prompt: label, tool: body.tool, toolOptions: body.options, params: {} },
  );
}
