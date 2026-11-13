import { CircleIcon, RotateCwIcon, SquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { deleteVoice, reloadVoices, toastError, transcribe, uploadSamples } from '@/lib/actions';
import { api } from '@/lib/api';
import { transcribeOptions } from '@/lib/audio/voices';
import { MAX_SAMPLE_SEC } from '@/lib/audio/wav';
import { useData, useSettings, useUi } from '@/lib/store';
import { transcribeApiLabel } from '@/lib/text/labels';
import type { VoiceInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AudioPlayer, DropZone } from '../shared';
import { ListDialog } from './ListDialog';

export function VoicesDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.voicesOpen);
  const editing = useUi((s) => s.editingVoice);
  const voices = useData((s) => s.voices);
  const v = voices.find((x) => x.name === editing);

  return (
    <ListDialog
      open={open}
      onOpenChange={(o) => useUi.setState({ voicesOpen: o })}
      title={t('voices.title')}
      items={voices.map((x) => ({ key: x.name, label: x.label, count: x.samples.length }))}
      active={editing}
      onSelect={(name) => useUi.setState({ editingVoice: name })}
      newPlaceholder={t('voices.newPlaceholder')}
      createLabel={t('voices.create')}
      folder="voices"
      onCreate={async (name, label) => {
        await api('/api/voices', { body: { name, label } });
        await reloadVoices();
        useUi.setState({ editingVoice: name });
      }}
    >
      {v ? <VoiceEditor key={v.name} v={v} /> : <p className="text-muted">{t('voices.empty')}</p>}
    </ListDialog>
  );
}

function VoiceEditor({ v }: { v: VoiceInfo }) {
  const { t, i18n } = useTranslation();
  const status = useData((s) => s.status);
  const set = useSettings((s) => s.set);
  const privacy = useSettings((s) => s.privacy);
  const [label, setLabel] = useState(v.label);
  const transcribeEngine = useSettings((s) => s.transcribeEngine);
  const transcribeLang = useSettings((s) => s.transcribeLang);
  const { engine, language } = transcribeOptions({ transcribeEngine, transcribeLang }, status?.transcribe.engine);

  const save = async () => {
    try {
      await api(`/api/voices/${encodeURIComponent(v.name)}`, { method: 'PUT', body: { label } });
      await reloadVoices();
      toast.success(t('toast.saved'));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <h2 className="section-title">voices/{v.name}/</h2>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('voices.displayName')} className="min-w-40 flex-1">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={() => void save()}>
          {t('common.save')}
        </Button>
        <Button variant="danger" onClick={() => void deleteVoice(v)}>
          {t('voices.delete')}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <Recorder name={v.name} />
        <Field label={t('voices.transcription')} className="flex-1">
          <Select
            value={engine}
            onValueChange={(x) => set({ transcribeEngine: x as 'local' | 'api' })}
            options={[
              { value: 'local', label: t('voices.engineLocal') },
              { value: 'api', label: transcribeApiLabel(t, status?.transcribe.apiModel, privacy) },
            ]}
          />
        </Field>
        <Field label={t('voices.language')}>
          <Select
            value={language}
            onValueChange={(x) => set({ transcribeLang: x })}
            options={[
              ...['de', 'en', 'fr', 'es', 'it'].map((c) => ({
                value: c,
                label: new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'language' }).of(c) ?? c,
              })),
              { value: 'auto', label: t('voices.auto') },
            ]}
          />
        </Field>
      </div>
      <DropZone label={t('voices.drop')} accept="audio/*,.m4a" onFiles={(files) => void uploadSamples(v.name, files)} />
      <p className="m-0 text-xs text-muted">{t('voices.info')}</p>
      <div className="flex flex-col gap-2">
        {v.samples.map((f) => (
          <Sample key={f} v={v} file={f} />
        ))}
      </div>
    </>
  );
}

function Sample({ v, file }: { v: VoiceInfo; file: string }) {
  const { t } = useTranslation();
  const busy = useUi((s) => s.transcribing.includes(`${v.name}/${file}`));
  // Only a changed saved transcript replaces the text field (reloading the voices must not wipe unsaved edits)
  const saved = v.transcripts?.[file] ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const base = `/api/voices/${encodeURIComponent(v.name)}/samples/${encodeURIComponent(file)}`;

  const remove = async () => {
    if (!window.confirm(t('voices.deleteSample', { file }))) return;
    try {
      await api(base, { method: 'DELETE' });
      await reloadVoices();
    } catch (err) {
      toastError(err);
    }
  };

  const saveTranscript = async () => {
    if (text === saved) return;
    try {
      await api(`/api/voices/${encodeURIComponent(v.name)}`, {
        method: 'PUT',
        body: { transcripts: { [file]: text } },
      });
      await reloadVoices();
      toast.success(t('toast.transcriptSaved'));
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <AudioPlayer src={base} />
        <Button size="sm" disabled={busy} onClick={() => void transcribe(v.name, file)}>
          <RotateCwIcon className={cn(busy && 'animate-spin')} />
          {t('voices.retranscribe')}
        </Button>
        <Button size="sm" variant="danger" onClick={() => void remove()}>
          {t('common.delete')}
        </Button>
      </div>
      <Textarea
        rows={2}
        disabled={busy}
        value={busy ? '' : text}
        placeholder={busy ? t('voices.transcribing') : t('voices.transcriptPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void saveTranscript()}
      />
    </div>
  );
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
};

/** Microphone stream, or null when access was denied or is not available. */
async function openMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch {
    return null;
  }
}

function stopTracks(stream: MediaStream) {
  for (const tr of stream.getTracks()) tr.stop();
}

/** Record from the microphone (browser processing off, so the timbre stays natural). */
function Recorder({ name }: { name: string }) {
  const { t } = useTranslation();
  const rec = useRef<MediaRecorder | null>(null);
  const mounted = useRef(false);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      rec.current?.stop();
    };
  }, []);

  /** Start recording on an open stream; throws if the browser cannot record it. */
  const record = (stream: MediaStream) => {
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    let timer: ReturnType<typeof setInterval> | undefined;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      clearInterval(timer);
      stopTracks(stream);
      rec.current = null;
      setSeconds(null);
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      const stamp = new Date().toLocaleTimeString().replace(/:/g, '-');
      void uploadSamples(name, [new File([blob], `recording_${stamp}`, { type: blob.type })]);
    };
    r.start();
    rec.current = r;
    const t0 = Date.now();
    timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SAMPLE_SEC && r.state !== 'inactive') r.stop();
    }, 250);
    setSeconds(0);
  };

  const start = async () => {
    if (startingRef.current || rec.current) return;
    startingRef.current = true;
    setStarting(true);
    const stream = await openMic();
    startingRef.current = false;
    setStarting(false);
    // The dialog may have closed while the permission prompt was open: release the mic right away
    if (!mounted.current) {
      if (stream) stopTracks(stream);
      return;
    }
    if (!stream) {
      toast.error(t('toast.micDenied'));
      return;
    }
    try {
      record(stream);
    } catch (err) {
      stopTracks(stream);
      toastError(err);
    }
  };

  return seconds === null ? (
    <Button disabled={starting} onClick={() => void start()}>
      <CircleIcon className="fill-err text-err" />
      {t('voices.record')}
    </Button>
  ) : (
    <Button variant="danger" onClick={() => rec.current?.stop()}>
      <SquareIcon className="fill-current" />
      {t('voices.stopRecording', { sec: seconds })}
    </Button>
  );
}
