import type { TFunction } from 'i18next';
import { XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox, SectionTitle, Tooltip } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { addExtraFiles } from '@/lib/actions';
import { outUrl } from '@/lib/api';
import { promptMentions } from '@/lib/mentions';
import {
  ASPECTS,
  allowedByPrivacy,
  COUNTS,
  enumVals,
  FORMATS,
  maxRefs,
  QUALITIES,
  RECOMMENDED_IMAGE,
  ratio,
  SIZES,
  sortByRecommendation,
} from '@/lib/models';
import { imageNotes } from '@/lib/notes';
import { estimateImagePrice, historyAvg, type UnitPrice, unitPrice, usd } from '@/lib/pricing';
import { useData, useSettings, useUi } from '@/lib/store';
import type { ImageModel } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Chip, DropZone, ElementThumb, NotesSection } from '../shared';
import { useModelName } from '../useModelName';
import { ZdrTag } from '../ZdrTag';

export function ImagePanel() {
  return (
    <div className="flex flex-col gap-5">
      <ElementSection />
      <ModelSection />
      <ParamSections />
      <ExtraRefsSection />
      <ImageNotes />
    </div>
  );
}

function ElementSection() {
  const { t } = useTranslation();
  const elements = useData((s) => s.elements);
  const element = useSettings((s) => s.element);
  const usePrefix = useSettings((s) => s.usePrefix);
  const set = useSettings((s) => s.set);
  const prompt = useUi((s) => s.prompt);
  const selected = elements.find((e) => e.name === element);
  const mentioned = promptMentions(prompt, elements).known.filter((e) => e !== selected);

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t('element.title')}</SectionTitle>
        <Button
          variant="link"
          onClick={() => useUi.setState({ elementsOpen: true, editingElement: element || elements[0]?.name || null })}
        >
          {t('element.manage')}
        </Button>
      </div>
      <Select
        value={selected ? element : ''}
        onValueChange={(v) => set({ element: v })}
        options={[
          { value: '', label: t('element.none') },
          ...elements.map((e) => ({
            value: e.name,
            label: t('element.option', { name: e.name, type: t(`types.${e.type}`), count: e.photos.length }),
          })),
        ]}
      />
      {selected && selected.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.photos.map((f) => (
            <ElementThumb key={f} el={selected} file={f} />
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1">
        {mentioned.length ? (
          <>
            <div className="text-xs text-muted">{t('element.fromPrompt')}</div>
            {mentioned.map((e) => (
              <div key={e.name} className="grid grid-cols-[28px_auto_1fr] items-center gap-2 text-[13px]">
                {e.photos[0] ? <ElementThumb el={e} file={e.photos[0]} size={28} /> : <span />}
                <span>@{e.name}</span>
                <span className="text-right text-xs text-muted">{t(`types.${e.type}`)}</span>
              </div>
            ))}
          </>
        ) : (
          <div className="text-xs text-muted">{t('element.mentionHint')}</div>
        )}
      </div>
      <Tooltip content={t('element.usePrefixHint')}>
        <span className="mt-2 flex items-center gap-2 text-[13px]">
          <Checkbox id="usePrefix" checked={usePrefix} onCheckedChange={(v) => set({ usePrefix: v === true })} />
          <label htmlFor="usePrefix" className="cursor-pointer">
            {t('element.usePrefix')}
          </label>
        </span>
      </Tooltip>
    </section>
  );
}

const UNIT_KEYS = {
  image: 'models.unitImage',
  megapixel: 'models.unitMegapixel',
  token: 'models.unitToken',
} as const;

/** List price per unit as text, e.g. "$0.04 per image". */
function unitPriceText(t: TFunction, unit: UnitPrice | null): string {
  if (!unit) return t('models.priceUnknown');
  return unit.unit === 'other' ? unit.value : t(UNIT_KEYS[unit.unit], { value: unit.value });
}

function PriceLine({ m }: { m: ImageModel }) {
  const { t } = useTranslation();
  const size = useSettings((s) => s.size);
  const quality = useSettings((s) => s.quality);
  const costs = useData((s) => s.status?.costs);
  const est = estimateImagePrice(m, size, quality);
  const hist = historyAvg(costs, m.id);
  const unitText = unitPriceText(t, unitPrice(m.price));
  const parts = [est !== null ? t('models.estimate', { price: usd(est) }) : unitText];
  if (hist) parts.push(t('models.history', { price: usd(hist.avg), count: hist.n }));
  return (
    <Tooltip content={t('models.priceHint', { price: unitText })}>
      <div className="mt-0.5 text-[11px] leading-[1.35] text-accent-2">{parts.join(' · ')}</div>
    </Tooltip>
  );
}

function ModelSection() {
  const { t } = useTranslation();
  const models = useData((s) => s.models);
  const selected = useSettings((s) => s.models);
  const privacy = useSettings((s) => s.privacy);
  const set = useSettings((s) => s.set);
  const showAll = useUi((s) => s.showAllModels);
  const name = useModelName();

  const { list, total } = useMemo(() => {
    const sorted = sortByRecommendation(
      models.filter((m) => maxRefs(m) > 0),
      RECOMMENDED_IMAGE,
    );
    const visible = (m: ImageModel) => RECOMMENDED_IMAGE.includes(m.id) || selected.includes(m.id);
    return { list: showAll ? sorted : sorted.filter(visible), total: sorted.length };
  }, [models, showAll, selected]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    set({ models: [...next] });
  };

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t('models.title')}</SectionTitle>
        <Button variant="link" onClick={() => useUi.setState({ showAllModels: !showAll })}>
          {showAll ? t('models.showRecommended') : t('models.showAll', { count: total })}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {list.map((m) => {
          const checked = selected.includes(m.id);
          const allowed = allowedByPrivacy(m.zdr, privacy);
          return (
            <Tooltip key={m.id} content={allowed ? m.id : t('models.blocked', { id: m.id })}>
              <label
                htmlFor={`model-${m.id}`}
                className={cn(
                  'grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-panel-2',
                  checked && 'border-line bg-panel-2',
                  !allowed && 'opacity-45',
                )}
              >
                <Checkbox
                  id={`model-${m.id}`}
                  className="mt-[3px]"
                  checked={checked}
                  onCheckedChange={(v) => toggle(m.id, v === true)}
                />
                <div className="min-w-0">
                  <div className="text-[13px] [overflow-wrap:anywhere]">{name(m.id)}</div>
                  <div className="mt-px text-[11px] leading-[1.35] text-muted [overflow-wrap:anywhere]">
                    {m.id} · {t('models.maxRefs', { count: maxRefs(m) })}
                  </div>
                  <PriceLine m={m} />
                </div>
                <ZdrTag zdr={m.zdr} />
              </label>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}

function AspectIcon({ value }: { value: string }) {
  const r = ratio(value);
  const w = r >= 1 ? 22 : Math.round(22 * r);
  const h = r >= 1 ? Math.round(22 / r) : 22;
  return <span className="rounded-[2px] border-[1.5px] border-current opacity-80" style={{ width: w, height: h }} />;
}

function ParamSections() {
  const { t } = useTranslation();
  const s = useSettings();
  const models = useData((d) => d.models);
  const selected = models.filter((m) => s.models.includes(m.id));

  const support = (key: string) => (v: string | number) => {
    if (v === '' || !selected.length) return 'all';
    const n = selected.filter((m) => enumVals(m, key)?.includes(String(v))).length;
    return n === selected.length ? 'all' : n === 0 ? 'none' : 'partial';
  };
  const aspectSupport = support('aspect_ratio');
  const sizeSupport = support('resolution');
  const qualitySupport = support('quality');
  const formatSupport = support('output_format');
  const anyQuality = selected.some((m) => enumVals(m, 'quality'));
  const hint = (st: string) =>
    st === 'partial' ? t('params.partial') : st === 'none' ? t('params.unsupported') : undefined;

  return (
    <>
      <section>
        <SectionTitle>{t('params.aspect')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {ASPECTS.map((a) => {
            // Aspect ratios are always adjusted to the nearest supported one, so "none" is shown as "partial"
            const st = aspectSupport(a) === 'none' ? 'partial' : aspectSupport(a);
            return (
              <Chip
                key={a}
                active={s.aspect === a}
                partial={st === 'partial'}
                title={hint(st)}
                onClick={() => s.set({ aspect: a })}
                className="flex h-14 min-w-[52px] flex-col items-center justify-end gap-1"
              >
                <AspectIcon value={a} />
                {a}
              </Chip>
            );
          })}
        </div>
      </section>
      <ChipSection
        title={t('params.size')}
        values={SIZES}
        current={s.size}
        label={(v) => v || t('params.auto')}
        support={sizeSupport}
        hint={hint}
        onPick={(v) => s.set({ size: String(v) })}
      />
      {anyQuality && (
        <ChipSection
          title={t('params.quality')}
          values={QUALITIES}
          current={s.quality}
          label={(v) => (v ? t(`params.${v as 'low' | 'medium' | 'high'}`) : t('params.auto'))}
          support={qualitySupport}
          hint={hint}
          onPick={(v) => s.set({ quality: String(v) })}
        />
      )}
      <ChipSection
        title={t('params.format')}
        values={FORMATS}
        current={s.format}
        label={(v) => (v ? String(v).toUpperCase() : t('params.auto'))}
        support={formatSupport}
        hint={hint}
        onPick={(v) => s.set({ format: String(v) })}
      />
      <ChipSection
        title={t('params.count')}
        values={COUNTS}
        current={s.count}
        label={(v) => String(v)}
        onPick={(v) => s.set({ count: Number(v) })}
      />
    </>
  );
}

function ChipSection<V extends string | number>({
  title,
  values,
  current,
  label,
  support,
  hint,
  onPick,
}: {
  title: string;
  values: V[];
  current: V;
  label: (v: V) => string;
  support?: (v: V) => string;
  hint?: (st: string) => string | undefined;
  onPick: (v: V) => void;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const st = support ? support(v) : 'all';
          return (
            <Chip
              key={String(v)}
              active={v === current}
              partial={st === 'partial'}
              disabled={st === 'none' && v !== current}
              title={hint?.(st)}
              onClick={() => onPick(v)}
            >
              {label(v)}
            </Chip>
          );
        })}
      </div>
    </section>
  );
}

function ExtraRefsSection() {
  const { t } = useTranslation();
  const refs = useUi((s) => s.extraRefs);
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionTitle>{t('refs.title')}</SectionTitle>
        <Button variant="link" onClick={() => useUi.setState({ extraRefs: [] })}>
          {t('refs.clear')}
        </Button>
      </div>
      <DropZone label={t('refs.drop')} accept="image/*" onFiles={(files) => void addExtraFiles(files)} />
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {refs.map((r, i) => (
            <div key={r.kind === 'out' ? r.outFile : `${r.name}-${i}`} className="relative">
              <img
                src={r.kind === 'out' ? outUrl(r.outFile) : r.dataUrl}
                title={r.kind === 'out' ? r.outFile : r.name}
                alt=""
                className="block size-[52px] rounded-md border border-line object-cover"
              />
              <button
                type="button"
                aria-label={t('refs.remove')}
                onClick={() => useUi.setState((s) => ({ extraRefs: s.extraRefs.filter((_, j) => j !== i) }))}
                className="absolute -top-1.5 -right-1.5 grid size-5 cursor-pointer place-items-center rounded-full border border-line bg-panel hover:border-accent"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImageNotes() {
  const settings = useSettings();
  const { models, elements, status } = useData();
  const prompt = useUi((u) => u.prompt);
  const extraRefCount = useUi((u) => u.extraRefs.length);
  const modelName = useModelName();
  const notes = imageNotes({ status, settings, models, elements, prompt, extraRefCount, modelName });
  return <NotesSection notes={notes} />;
}
