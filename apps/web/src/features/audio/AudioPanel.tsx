import type { TFunction } from 'i18next';
import { PlayIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input, RadioDot, SectionTitle, Tag, Tooltip } from '@/components/ui/misc';
import { Select, type SelectGroup } from '@/components/ui/select';
import { refreshHistory, toastError } from '@/lib/actions';
import { api, outUrl } from '@/lib/api';
import {
  demoText,
  fallbackVoice,
  followsInstructions,
  langName,
  SPEEDS,
  speechLangs,
  speechPrice,
  voiceGroups,
  voiceLang,
} from '@/lib/audio/voices';
import { allowedByPrivacy, shortList, shortName, sortModels } from '@/lib/models/models';
import { useData, useSettings, useUi } from '@/lib/store';
import type { SpeechModel } from '@/lib/types';
import { FavoriteStar, ModelCardBody, ModelRow } from '../app/ModelMarks';
import { ZdrTag } from '../app/ZdrTag';
import { Chip, PanelNotes } from '../shared';

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
      <PanelNotes />
    </div>
  );
}

function SpeechSections() {
  const { t, i18n } = useTranslation();
  const s = useSettings();
  const speechModels = useData((d) => d.speechModels);
  const voices = useData((d) => d.voices);
  const showAll = useUi((u) => u.showAllSpeech);
  const sorted = useMemo(() => sortModels(speechModels), [speechModels]);
  const model = speechModels.find((m) => m.id === s.speechModel);
  useValidSpeechSelection(model, sorted);

  const list = showAll ? sorted : shortList(sorted, [s.speechModel]);
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
            ariaLabel={t('audio.voice')}
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

/** Keep model and voice valid once the models are loaded (only subscribes to what it reads, so set() cannot loop). */
function useValidSpeechSelection(model: SpeechModel | undefined, sorted: SpeechModel[]) {
  const voice = useSettings((s) => s.voice);
  const set = useSettings((s) => s.set);
  const voices = useData((d) => d.voices);
  useEffect(() => {
    if (!sorted.length) return;
    if (!model) {
      set({ speechModel: sorted[0].id });
      return;
    }
    const next = fallbackVoice(model, voice, voices);
    if (next !== null) set({ voice: next });
  }, [model, sorted, voice, voices, set]);
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
    <ModelRow
      checked={checked}
      blocked={!allowed}
      favorite={<FavoriteStar kind="speech" id={m.id} favorite={m.favorite} />}
    >
      <Tooltip content={allowed ? undefined : t('models.blocked', { id: m.id })}>
        <button
          type="button"
          aria-pressed={checked}
          onClick={onPick}
          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 py-1.5 pl-2 text-left"
        >
          <ModelCardBody
            control={<RadioDot checked={checked} />}
            name={shortName(m.name)}
            created={m.created}
            id={m.id}
            capabilities={[
              voicesText,
              speechLangsText(t, m),
              followsInstructions(m.id) && t('audio.followsInstructions'),
            ]
              .filter(Boolean)
              .join(' · ')}
            price={speechPriceText(t, m)}
            tags={
              <>
                <ZdrTag zdr={m.zdr} />
                {m.cloning && (
                  <Tooltip content={t('audio.cloneHint')}>
                    <Tag tone="accent">{t('audio.clone')}</Tag>
                  </Tooltip>
                )}
              </>
            }
          />
        </button>
      </Tooltip>
    </ModelRow>
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
      toastError(err);
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
  const unsorted = useData((d) => d.musicModels);
  const musicModels = useMemo(() => sortModels(unsorted), [unsorted]);
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
            <ModelRow
              key={m.id}
              checked={m.id === musicModel}
              favorite={<FavoriteStar kind="music" id={m.id} favorite={m.favorite} />}
            >
              <button
                type="button"
                aria-pressed={m.id === musicModel}
                onClick={() => set({ musicModel: m.id })}
                className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 py-1.5 pl-2 text-left"
              >
                <ModelCardBody
                  control={<RadioDot checked={m.id === musicModel} />}
                  name={shortName(m.name)}
                  created={m.created}
                  id={m.id}
                  price={price ?? t('audio.priceNa')}
                  tags={<ZdrTag zdr={m.zdr} />}
                />
              </button>
            </ModelRow>
          );
        })}
      </div>
      {current && <p className="mt-1.5 text-xs text-muted">{current.description.slice(0, 260)}</p>}
    </section>
  );
}
