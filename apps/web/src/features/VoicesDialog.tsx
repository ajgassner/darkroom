import { CircleIcon, RotateCwIcon, SquareIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { reloadVoices, transcribe, transcribeSettings, uploadSamples } from '@/lib/actions';
import { api } from '@/lib/api';
import { useData, useSettings, useUi } from '@/lib/store';
import type { VoiceInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { MAX_SAMPLE_SEC } from '@/lib/wav';
import { ListDialog } from './ListDialog';
import { AudioPlayer, DropZone } from './shared';

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
      onCreate={async (name) => {
        await api('/api/voices', { body: { name, label: name } });
        await reloadVoices();
        useUi.setState({ editingVoice: name });
      }}
    >
      {v ? <VoiceEditor key={v.name} v={v} /> : <p className="text-muted">{t('voices.empty')}</p>}
    </ListDialog>
  );
}

function VoiceEditor({ v }: { v: VoiceInfo }) {
  const { t } = useTranslation();
  const status = useData((s) => s.status);
  const set = useSettings((s) => s.set);
  const [label, setLabel] = useState(v.label);
  const { engine, language } = transcribeSettings();

  const save = async () => {
    await api(`/api/voices/${encodeURIComponent(v.name)}`, { method: 'PUT', body: { label } });
    await reloadVoices();
    toast.success(t('toast.saved'));
  };

  return (
    <>
      <h2 className="section-title">voices/{v.name}/</h2>
      <div className="flex items-end gap-2">
        <Field label={t('voices.displayName')} className="flex-1">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={() => void save()}>
          {t('common.save')}
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
              {
                value: 'api',
                label: t('voices.engineApi', {
                  model: (status?.transcribe.apiModel ?? 'Whisper').replace(/^[^/]+\//, ''),
                }),
              },
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
                label: new Intl.DisplayNames([navigator.language], { type: 'language' }).of(c) ?? c,
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
  const [text, setText] = useState(v.transcripts?.[file] ?? '');
  useEffect(() => setText(v.transcripts?.[file] ?? ''), [v.transcripts, file]);
  const base = `/api/voices/${encodeURIComponent(v.name)}/samples/${encodeURIComponent(file)}`;

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <AudioPlayer src={base} />
        <Button size="sm" disabled={busy} onClick={() => void transcribe(v.name, file)}>
          <RotateCwIcon className={cn(busy && 'animate-spin')} />
          {t('voices.retranscribe')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            if (!window.confirm(t('voices.deleteSample', { file }))) return;
            await api(base, { method: 'DELETE' });
            await reloadVoices();
          }}
        >
          {t('common.delete')}
        </Button>
      </div>
      <Textarea
        rows={2}
        disabled={busy}
        value={busy ? '' : text}
        placeholder={busy ? t('voices.transcribing') : t('voices.transcriptPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (text === (v.transcripts?.[file] ?? '')) return;
          await api(`/api/voices/${encodeURIComponent(v.name)}`, {
            method: 'PUT',
            body: { transcripts: { [file]: text } },
          });
          await reloadVoices();
          toast.success(t('toast.transcriptSaved'));
        }}
      />
    </div>
  );
}

/** Record from the microphone (browser processing off, so the timbre stays natural). */
function Recorder({ name }: { name: string }) {
  const { t } = useTranslation();
  const rec = useRef<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch {
      toast.error(t('toast.micDenied'));
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    rec.current = r;
    const t0 = Date.now();
    const timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SAMPLE_SEC) r.stop();
    }, 250);
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      clearInterval(timer);
      for (const tr of stream.getTracks()) tr.stop();
      rec.current = null;
      setSeconds(null);
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      const stamp = new Date().toLocaleTimeString().replace(/:/g, '-');
      void uploadSamples(name, [new File([blob], `recording_${stamp}`, { type: blob.type })]);
    };
    r.start();
    setSeconds(0);
  };

  return seconds === null ? (
    <Button onClick={() => void start()}>
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
