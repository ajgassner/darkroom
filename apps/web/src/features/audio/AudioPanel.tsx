import type { TFunction } from 'i18next';
import { PlayIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, RadioDot, SectionTitle, Tag, Tooltip } from '@/components/ui/misc';
import { Select, type SelectGroup } from '@/components/ui/select';
import { errorMessage, refreshHistory } from '@/lib/actions';
import { api, outUrl } from '@/lib/api';
import { allowedByPrivacy, RECOMMENDED_SPEECH, shortName, sortByRecommendation } from '@/lib/models';
import { audioNotes } from '@/lib/notes';
import { useData, useSettings, useUi } from '@/lib/store';
import type { SpeechModel } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  demoText,
  fallbackVoice,
  langName,
  SPEEDS,
  speechLangs,
  speechPrice,
  voiceGroups,
  voiceLang,
} from '@/lib/voices';
import { Chip, NotesSection } from '../shared';
import { ZdrTag } from '../ZdrTag';

export function AudioPanel() {
  const { t } = useTranslation();
  const audioKind = useSettings((s) => s.audioKind);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>{t('audio.kind')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(['speech', 'music'] as const).map((k) => (
            <Chip key={k} active={audioKind === k} onClick={() => set({ audioKind: k })}>
              {t(`audio.${k}`)}
            </Chip>
          ))}
        </div>
      </section>
      {audioKind === 'speech' ? <SpeechSections /> : <MusicSection />}
      <AudioNotes />
    </div>
  );
}

function SpeechSections() {
  const { t, i18n } = useTranslation();
  const s = useSettings();
  const speechModels = useData((d) => d.speechModels);
  const voices = useData((d) => d.voices);
  const showAll = useUi((u) => u.showAllSpeech);
  const sorted = useMemo(() => sortByRecommendation(speechModels, RECOMMENDED_SPEECH), [speechModels]);
  const model = speechModels.find((m) => m.id === s.speechModel);

  // Keep the selection valid once models are loaded
  useEffect(() => {
    if (!speechModels.length) return;
    if (!model) {
      s.set({ speechModel: sorted[0]?.id ?? '' });
      return;
    }
    const next = fallbackVoice(model, s.voice, voices);
    if (next !== null) s.set({ voice: next });
  }, [speechModels, model, sorted, voices, s]);

  const list = showAll ? sorted : sorted.filter((m) => RECOMMENDED_SPEECH.includes(m.id) || m.id === s.speechModel);
  const lang = i18n.resolvedLanguage ?? 'en';

  const groups = useMemo<SelectGroup[]>(
    () =>
      voiceGroups(model, voices, lang, {
        own: t('audio.groupOwn'),
        ownNoClone: t('audio.groupOwnNoClone'),
        multi: t('audio.groupMulti'),
      }),
    [voices, model, lang, t],
  );

  const vl = voiceLang(model, s.voice);
  const voiceInfo =
    vl.code === 'own'
      ? t('audio.voiceOwn')
      : vl.code === 'multi'
        ? t('audio.voiceMulti')
        : t('audio.voiceLang', { lang: langName(vl, lang) });

  return (
    <>
      <section>
        <div className="flex items-baseline justify-between">
          <SectionTitle>{t('audio.speechModel')}</SectionTitle>
          <Button variant="link" onClick={() => useUi.setState({ showAllSpeech: !showAll })}>
            {showAll ? t('models.showRecommended') : t('models.showAll', { count: sorted.length })}
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          {list.map((m) => (
            <SpeechRow key={m.id} m={m} checked={m.id === s.speechModel} onPick={() => s.set({ speechModel: m.id })} />
          ))}
        </div>
      </section>
      <section>
        <div className="flex items-baseline justify-between">
          <SectionTitle>{t('audio.voice')}</SectionTitle>
          <Button
            variant="link"
            onClick={() =>
              useUi.setState({
                voicesOpen: true,
                editingVoice: s.voice.startsWith('voice:') ? s.voice.slice(6) : (voices[0]?.name ?? null),
              })
            }
          >
            {t('audio.ownVoices')}
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Select
            className="min-w-0 flex-1"
            value={s.voice}
            onValueChange={(v) => s.set({ voice: v })}
            groups={
              model?.voices.length
                ? groups
                : [{ label: '', options: [{ value: '', label: t('audio.voiceDefault') }] }, ...groups]
            }
          />
          <DemoButton model={model} />
        </div>
        <p className="mt-1.5 text-xs text-muted">{voiceInfo}</p>
      </section>
      <section>
        <SectionTitle>{t('audio.instructions')}</SectionTitle>
        <Input
          value={s.instructions}
          placeholder={t('audio.instructionsPlaceholder')}
          onChange={(e) => s.set({ instructions: e.target.value })}
        />
      </section>
      <section>
        <SectionTitle>{t('audio.speed')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {SPEEDS.map((v) => (
            <Chip key={v} active={s.speed === v} onClick={() => s.set({ speed: v })}>
              {`${v.toLocaleString(lang)}×`}
            </Chip>
          ))}
        </div>
      </section>
    </>
  );
}

function speechPriceText(t: TFunction, m: SpeechModel): string {
  const price = speechPrice(m);
  if (!price) return t('audio.priceNa');
  return price.per === 'chars'
    ? t('audio.pricePerChars', { value: price.value })
    : t('audio.pricePerUnit', { value: price.value });
}

function speechLangsText(t: TFunction, m: SpeechModel): string {
  const langs = speechLangs(m);
  if (langs.has('multi')) return t('audio.langsMulti');
  if (langs.has('de')) return t('audio.langsInclDe');
  return [...langs].slice(0, 2).join(', ') + (langs.size > 2 ? ' …' : '');
}

function SpeechRow({ m, checked, onPick }: { m: SpeechModel; checked: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  const privacy = useSettings((s) => s.privacy);
  const allowed = allowedByPrivacy(m.zdr, privacy);
  const voicesText = m.voices.length ? t('audio.voices', { count: m.voices.length }) : t('audio.ownVoice');
  return (
    <Tooltip content={allowed ? m.id : t('models.blocked', { id: m.id })}>
      <button
        type="button"
        onClick={onPick}
        className={cn(
          'grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:bg-panel-2',
          checked && 'border-line bg-panel-2',
          !allowed && 'opacity-45',
        )}
      >
        <RadioDot checked={checked} />
        <div className="min-w-0">
          <div className="text-[13px]">{shortName(m.name)}</div>
          <div className="mt-px text-[11px] leading-[1.35] text-muted [overflow-wrap:anywhere]">
            {speechPriceText(t, m)} · {voicesText} · {speechLangsText(t, m)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-[3px]">
          <ZdrTag zdr={m.zdr} />
          {m.cloning && (
            <Tooltip content={t('audio.cloneHint')}>
              <Tag tone="accent">{t('audio.clone')}</Tag>
            </Tooltip>
          )}
        </div>
      </button>
    </Tooltip>
  );
}

/** Play a short sample of the selected voice (generated once on the server, then cached). */
function DemoButton({ model }: { model: SpeechModel | undefined }) {
  const { t, i18n } = useTranslation();
  const voice = useSettings((s) => s.voice);
  const privacy = useSettings((s) => s.privacy);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const click = async () => {
    if (!model) return;
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const r = await api<{ file: string; cached: boolean }>('/api/speech/demo', {
        body: {
          model: model.id,
          voice,
          text: demoText(voiceLang(model, voice), i18n.resolvedLanguage ?? 'en'),
          privacy,
        },
      });
      audio.current?.pause();
      const a = new Audio(`${outUrl(r.file)}?v=${Date.now()}`);
      audio.current = a;
      a.onended = () => setState('idle');
      await a.play();
      setState('playing');
      if (!r.cached) void refreshHistory();
    } catch (err) {
      toast.error(errorMessage(err));
      setState('idle');
    }
  };

  return (
    <Tooltip content={t('audio.demoHint')}>
      <Button
        size="sm"
        className="py-[7px] text-xs"
        disabled={state === 'loading' || !model}
        onClick={() => void click()}
      >
        {state === 'playing' ? (
          <SquareIcon className="size-3 fill-current" />
        ) : (
          <PlayIcon className="size-3 fill-current" />
        )}
        {state === 'loading' ? t('audio.generating') : state === 'playing' ? t('audio.stop') : t('audio.listen')}
      </Button>
    </Tooltip>
  );
}

function MusicSection() {
  const { t } = useTranslation();
  const musicModels = useData((d) => d.musicModels);
  const musicModel = useSettings((s) => s.musicModel);
  const set = useSettings((s) => s.set);
  useEffect(() => {
    if (musicModels.length && !musicModels.some((m) => m.id === musicModel)) set({ musicModel: musicModels[0].id });
  }, [musicModels, musicModel, set]);
  const current = musicModels.find((m) => m.id === musicModel);
  return (
    <section>
      <SectionTitle>{t('audio.musicModel')}</SectionTitle>
      <div className="flex flex-col gap-1">
        {musicModels.map((m) => {
          const price = /\$[\d.]+ per [a-z ]+/i.exec(m.description)?.[0];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => set({ musicModel: m.id })}
              className={cn(
                'grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left hover:bg-panel-2',
                m.id === musicModel && 'border-line bg-panel-2',
              )}
            >
              <RadioDot checked={m.id === musicModel} />
              <div className="min-w-0">
                <div className="text-[13px]">{shortName(m.name)}</div>
                <div className="mt-px text-[11px] text-muted [overflow-wrap:anywhere]">
                  {m.id}
                  {price ? ` · ${price}` : ''}
                </div>
              </div>
              <ZdrTag zdr={m.zdr} />
            </button>
          );
        })}
      </div>
      {current && <p className="mt-1.5 text-xs text-muted">{current.description.slice(0, 260)}</p>}
    </section>
  );
}

function AudioNotes() {
  const settings = useSettings();
  const { speechModels, musicModels, voices, status } = useData();
  return <NotesSection notes={audioNotes({ status, settings, speechModels, musicModels, voices })} />;
}
