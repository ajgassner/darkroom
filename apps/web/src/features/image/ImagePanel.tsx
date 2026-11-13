import type { TFunction } from 'i18next';
import { XIcon } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox, InfoTip, SectionTitle, Tooltip } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { addExtraFiles } from '@/lib/actions';
import { outUrl } from '@/lib/api';
import {
  chipState,
  fallbackText,
  imageCapabilities,
  type ParamKey,
  type ValueSupport,
  valueSupport,
} from '@/lib/models/capabilities';
import {
  ASPECTS,
  allowedByPrivacy,
  COUNTS,
  enumVals,
  FORMATS,
  maxRefs,
  QUALITIES,
  ratio,
  SIZES,
  shortList,
  sortModels,
} from '@/lib/models/models';
import { historyAvg, type UnitPrice, unitPrice } from '@/lib/models/pricing';
import { useData, useSettings, useUi } from '@/lib/store';
import { usd } from '@/lib/text/format';
import { promptMentions } from '@/lib/text/mentions';
import type { ImageModel } from '@/lib/types';
import { FavoriteStar, ModelCardBody, ModelRow } from '../app/ModelMarks';
import { ZdrTag } from '../app/ZdrTag';
import { useModelName } from '../hooks/useModelName';
import { Chip, DropZone, ElementThumb, PanelNotes } from '../shared';

export function ImagePanel() {
  return (
    <div className="flex flex-col gap-5">
      <ElementSection />
      <ModelSection />
      <ParamSections />
      <ExtraRefsSection />
      <PanelNotes />
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
        ariaLabel={t('element.title')}
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

/** The API list price as OpenRouter publishes it (no estimate), plus the real average of the user's own images. */
function PriceLine({ m }: { m: ImageModel }) {
  const { t } = useTranslation();
  const costs = useData((s) => s.status?.costs);
  const hist = historyAvg(costs, m.id);
  const parts = [unitPriceText(t, unitPrice(m.price))];
  if (hist) parts.push(t('models.history', { price: usd(hist.avg), count: hist.n }));
  return parts.join(' · ');
}

/** "1K–4K · 5 ratios · max 8 refs · PNG/JPEG"; the ratio count opens the full list (hover, focus or tap). */
function CapabilityLine({ m }: { m: ImageModel }) {
  const { t } = useTranslation();
  const caps = imageCapabilities(m);
  const parts: { key: string; node: ReactNode }[] = [];
  if (caps.sizes) parts.push({ key: 'sizes', node: caps.sizes });
  if (caps.aspects.length) {
    parts.push({
      key: 'aspects',
      node: (
        <InfoTip content={t('models.aspectsHint', { list: caps.aspects.join(', ') })}>
          {t('models.aspects', { count: caps.aspects.length })}
        </InfoTip>
      ),
    });
  }
  parts.push({ key: 'refs', node: t('models.maxRefs', { count: caps.refs }) });
  if (caps.formats.length) parts.push({ key: 'formats', node: caps.formats.join('/') });
  return parts.map((p, i) => (
    <span key={p.key} className="whitespace-nowrap">
      {i > 0 && ' · '}
      {p.node}
    </span>
  ));
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
    const sorted = sortModels(models.filter((m) => maxRefs(m) > 0));
    return { list: showAll ? sorted : shortList(sorted, selected), total: sorted.length };
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
            <ModelRow
              key={m.id}
              checked={checked}
              blocked={!allowed}
              favorite={<FavoriteStar kind="image" id={m.id} favorite={m.favorite} />}
            >
              <Tooltip content={allowed ? undefined : t('models.blocked', { id: m.id })}>
                <label
                  htmlFor={`model-${m.id}`}
                  className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-2 py-1.5 pl-2"
                >
                  <ModelCardBody
                    control={
                      <Checkbox
                        id={`model-${m.id}`}
                        className="mt-[3px]"
                        checked={checked}
                        onCheckedChange={(v) => toggle(m.id, v === true)}
                      />
                    }
                    name={name(m.id)}
                    created={m.created}
                    id={m.id}
                    capabilities={<CapabilityLine m={m} />}
                    price={<PriceLine m={m} />}
                    tags={<ZdrTag zdr={m.zdr} />}
                  />
                </label>
              </Tooltip>
            </ModelRow>
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
  const name = useModelName();
  const selected = models.filter((m) => s.models.includes(m.id));
  const autoLabel = (v: string) => v || t('params.auto');
  const groups: ChipGroup[] = [
    {
      key: 'aspect_ratio',
      title: t('params.aspect'),
      values: ASPECTS,
      current: s.aspect,
      label: (v) => v,
      render: (v) => (
        <>
          <AspectIcon value={v} />
          {v}
        </>
      ),
      chipClassName: 'flex h-14 min-w-[52px] flex-col items-center justify-end gap-1',
      alwaysSelectable: true,
      onPick: (v) => s.set({ aspect: v }),
    },
    {
      key: 'resolution',
      title: t('params.size'),
      values: SIZES,
      current: s.size,
      label: autoLabel,
      onPick: (v) => s.set({ size: v }),
    },
  ];
  if (selected.some((m) => enumVals(m, 'quality'))) {
    groups.push({
      key: 'quality',
      title: t('params.quality'),
      values: QUALITIES,
      current: s.quality,
      label: (v) => (v ? t(`params.${v as 'low' | 'medium' | 'high'}`) : t('params.auto')),
      onPick: (v) => s.set({ quality: v }),
    });
  }
  groups.push({
    key: 'output_format',
    title: t('params.format'),
    values: FORMATS,
    current: s.format,
    label: (v) => (v ? v.toUpperCase() : t('params.auto')),
    onPick: (v) => s.set({ format: v }),
  });

  const rows = groups.map((g) => ({ g, supports: g.values.map((v) => valueSupport(selected, g.key, v, name)) }));
  const anyPartial = rows.some(({ g, supports }) =>
    supports.some((sup, i) => chipState(sup, g.values[i] === g.current, g.alwaysSelectable).partial),
  );
  return (
    <>
      {rows.map(({ g, supports }) => (
        <ParamGroup key={g.key} group={g} supports={supports} />
      ))}
      <section>
        <SectionTitle>{t('params.count')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {COUNTS.map((n) => (
            <Chip key={n} active={s.count === n} onClick={() => s.set({ count: n })}>
              {String(n)}
            </Chip>
          ))}
        </div>
        {anyPartial && <p className="mt-2.5 text-[11px] leading-[1.4] text-muted">{t('params.legend')}</p>}
      </section>
    </>
  );
}

interface ChipGroup {
  key: ParamKey;
  title: string;
  values: string[];
  current: string;
  /** Text of a value (also used in the hints). */
  label: (v: string) => string;
  /** Chip content, if it is more than the label. */
  render?: (v: string) => ReactNode;
  chipClassName?: string;
  alwaysSelectable?: boolean;
  onPick: (v: string) => void;
}

/**
 * Chips of one parameter. A ≈ chip names the models that can't take the value in its tooltip; for the current value
 * the same text stays visible below the chips (touch screens have no tooltips).
 */
function ParamGroup({ group: g, supports }: { group: ChipGroup; supports: ValueSupport[] }) {
  const { t } = useTranslation();
  const hint = (i: number) => fallbackText(t, g.key, g.label(g.values[i]), supports[i].fallbacks);
  const currentIndex = g.values.indexOf(g.current);
  const currentHint = currentIndex >= 0 ? hint(currentIndex) : '';
  return (
    <section>
      <SectionTitle>{g.title}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {g.values.map((v, i) => {
          const st = chipState(supports[i], v === g.current, g.alwaysSelectable);
          return (
            <Chip
              key={v}
              active={v === g.current}
              partial={st.partial}
              disabled={st.disabled}
              title={hint(i) || undefined}
              onClick={() => g.onPick(v)}
              className={g.chipClassName}
            >
              {g.render ? g.render(v) : g.label(v)}
            </Chip>
          );
        })}
      </div>
      {currentHint && <p className="mt-1.5 text-[11px] leading-[1.4] text-warn">≈ {currentHint}</p>}
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
      <Button variant="link" className="mt-1.5" onClick={() => useUi.setState({ uploadsOpen: true })}>
        {t('refs.previous')}
      </Button>
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
