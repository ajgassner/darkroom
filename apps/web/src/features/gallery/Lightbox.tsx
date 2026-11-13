import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, SectionTitle, Tag } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { deleteEntries, entryNotices, reuseSettings } from '@/lib/actions';
import { canBeTransparent, downloadUrl, outUrl } from '@/lib/api';
import { ASPECTS, isNewModel, preferredModel, releaseMonth, toolModels, zdrState } from '@/lib/models/models';
import { entryTitle, relightOptions } from '@/lib/models/tools';
import { runTool } from '@/lib/runs';
import { useData, useSettings, useUi } from '@/lib/store';
import { entryInfoRows } from '@/lib/text/labels';
import type { ImageModel, ManifestEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useModelName } from '../hooks/useModelName';

export function Lightbox() {
  const { t } = useTranslation();
  const e = useUi((s) => s.lightbox);
  const stripMeta = useSettings((s) => s.stripMeta);
  const set = useSettings((s) => s.set);
  const close = () => useUi.setState({ lightbox: null });
  if (!e?.file) return null;
  const file = e.file;
  const title = entryTitle(t, e);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent closeLabel={t('common.close')} className="h-[92vh] w-[min(1400px,96vw)]">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="grid h-full grid-cols-1 md:grid-cols-[1fr_340px]">
          <div className="flex min-h-0 items-center justify-center bg-black">
            <FullImage file={file} alt={title} />
          </div>
          <div className="flex flex-col gap-3.5 overflow-y-auto px-[18px] pt-12 pb-[18px] text-[13px]">
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  useUi.setState((s) => ({
                    lightbox: null,
                    extraRefs: s.extraRefs.some((r) => r.kind === 'out' && r.outFile === file)
                      ? s.extraRefs
                      : [...s.extraRefs, { kind: 'out', outFile: file }],
                  }));
                  set({ mode: 'image' });
                  toast.success(t('toast.refAdded'));
                }}
              >
                {t('lightbox.useAsRef')}
              </Button>
              {!e.tool && (
                <Button
                  onClick={() => {
                    close();
                    reuseSettings([e]);
                  }}
                >
                  {t('lightbox.reuse')}
                </Button>
              )}
              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <a href={downloadUrl(file, stripMeta)} download={file}>
                    {stripMeta ? t('gallery.downloadClean') : t('common.download')}
                  </a>
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={async () => {
                    if (await deleteEntries({ ids: e.id ? [e.id] : [], files: [file] }, t('gallery.confirmImage')))
                      close();
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
              <label
                htmlFor="strip-meta"
                className="flex cursor-pointer items-center gap-2 text-xs text-muted"
                title={t('lightbox.stripMetaHint')}
              >
                <Checkbox id="strip-meta" checked={stripMeta} onCheckedChange={(v) => set({ stripMeta: v === true })} />
                {t('lightbox.stripMeta')}
              </label>
              {e.debugId && (
                <Button variant="link" className="self-start" onClick={() => useUi.setState({ debugEntry: e })}>
                  {t('lightbox.debug')}
                </Button>
              )}
            </div>
            <Tools key={e.id ?? file} e={e} onRun={close} />
            <Info e={e} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The result at full size; PNG/WebP with a checkerboard behind transparent parts (as in the debug dialog). */
function FullImage({ file, alt }: { file: string; alt: string }) {
  return (
    <img
      src={outUrl(file)}
      alt={alt}
      className={cn('max-h-[92vh] max-w-full object-contain', canBeTransparent(file) && 'checker')}
    />
  );
}

function Info({ e }: { e: ManifestEntry }) {
  const { t } = useTranslation();
  const name = useModelName();
  const rows = entryInfoRows(t, e, name);
  const notices = entryNotices(e);
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {notices.length > 0 && <div className="text-muted">{notices.join(' · ')}</div>}
      {e.fullPrompt && (
        <details>
          <summary className="cursor-pointer text-muted">{t('lightbox.sentPrompt')}</summary>
          <pre className="m-0 mt-1 rounded-lg bg-panel-2 p-2 text-xs whitespace-pre-wrap">{e.fullPrompt}</pre>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Tools

type ToolField = { key: string; label: string; options?: [string, string][]; def?: string; text?: boolean };
type ToolDef = { id: string; label: string; ai: boolean; hint: string; fields: ToolField[] };

function useToolDefs(): ToolDef[] {
  const { t } = useTranslation();
  const relight = relightOptions(
    t,
    useData((s) => s.status?.relightPresets),
  );
  const aspects = ASPECTS.map((a) => [a, a] as [string, string]);
  return [
    {
      id: 'upscale',
      label: t('tools.upscale'),
      ai: true,
      hint: t('tools.upscaleHint'),
      fields: [
        {
          key: 'resolution',
          label: t('params.size'),
          options: [
            ['2K', '2K'],
            ['4K', '4K'],
          ],
          def: '4K',
        },
      ],
    },
    {
      id: 'resize',
      label: t('tools.resize'),
      ai: false,
      hint: t('tools.resizeHint'),
      fields: [
        {
          key: 'factor',
          label: t('tools.factor'),
          options: [
            ['0.5', '0.5×'],
            ['1.5', '1.5×'],
            ['2', '2×'],
            ['3', '3×'],
            ['4', '4×'],
          ],
          def: '2',
        },
      ],
    },
    {
      id: 'expand',
      label: t('tools.expand'),
      ai: true,
      hint: t('tools.expandHint'),
      fields: [
        { key: 'aspect', label: t('tools.targetAspect'), options: aspects, def: '16:9' },
        { key: 'note', label: t('tools.expandNote'), text: true },
      ],
    },
    {
      id: 'crop',
      label: t('tools.crop'),
      ai: false,
      hint: t('tools.cropHint'),
      fields: [
        { key: 'aspect', label: t('tools.format'), options: aspects, def: '1:1' },
        {
          key: 'position',
          label: t('tools.position'),
          options: [
            ['attention', t('tools.attention')],
            ['center', t('tools.center')],
          ],
          def: 'attention',
        },
      ],
    },
    {
      id: 'relight',
      label: t('tools.relight'),
      ai: true,
      hint: t('tools.relightHint'),
      fields: [
        { key: 'preset', label: t('tools.light'), options: relight, def: 'golden' },
        { key: 'custom', label: t('tools.customLight'), text: true },
      ],
    },
    {
      id: 'cleanup',
      label: t('tools.cleanup'),
      ai: true,
      hint: t('tools.cleanupHint'),
      fields: [{ key: 'note', label: t('tools.cleanupNote'), text: true }],
    },
    {
      id: 'removebg',
      label: t('tools.removebg'),
      ai: false,
      hint: t('tools.removebgHint'),
      fields: [
        {
          key: 'background',
          label: t('tools.background'),
          options: [
            ['transparent', t('tools.transparent')],
            ['#ffffff', t('tools.white')],
            ['#f2f2f2', t('tools.lightGray')],
            ['#000000', t('tools.black')],
          ],
          def: 'transparent',
        },
      ],
    },
  ];
}

function Tools({ e, onRun }: { e: ManifestEntry; onRun: () => void }) {
  const { t } = useTranslation();
  const defs = useToolDefs();
  const [toolId, setToolId] = useState<string | null>(null);
  const tool = defs.find((d) => d.id === toolId);
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <SectionTitle className="mb-0">{t('tools.title')}</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {defs.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={toolId === d.id}
            onClick={() => setToolId(toolId === d.id ? null : d.id)}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-left text-xs hover:border-accent',
              toolId === d.id && 'border-accent bg-[color-mix(in_srgb,var(--accent)_18%,var(--panel-2))]',
            )}
          >
            {d.label}
            <Tag tone={d.ai ? undefined : 'ok'}>{d.ai ? t('tools.ai') : t('tools.local')}</Tag>
          </button>
        ))}
      </div>
      {tool && <ToolForm key={tool.id} tool={tool} e={e} onRun={onRun} />}
    </div>
  );
}

function ToolOption({
  field,
  value,
  onChange,
}: {
  field: ToolField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={field.label}>
      {field.text ? (
        <Input className="bg-panel" value={value} onChange={(ev) => onChange(ev.target.value)} />
      ) : (
        <Select
          className="bg-panel"
          value={value}
          onValueChange={onChange}
          options={(field.options ?? []).map(([v, label]) => ({ value: v, label }))}
        />
      )}
    </Field>
  );
}

/** Model and element selection of the AI tools. */
function AiToolOptions({
  candidates,
  model,
  setModel,
  element,
  setElement,
}: {
  candidates: ImageModel[];
  model: string;
  setModel: (id: string) => void;
  element: string;
  setElement: (name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const name = useModelName();
  const elements = useData((s) => s.elements);
  const label = (m: ImageModel) =>
    [
      name(m.id),
      releaseMonth(m.created, i18n.resolvedLanguage ?? 'en'),
      isNewModel(m.created) && t('models.new'),
      t(`zdr.${zdrState(m.zdr)}`),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      <Field label={t('tools.model')}>
        <Select
          className="bg-panel"
          value={model}
          onValueChange={setModel}
          options={candidates.map((m) => ({ value: m.id, label: label(m) }))}
        />
      </Field>
      <Field label={t('tools.element')}>
        <Select
          className="bg-panel"
          value={element}
          onValueChange={setElement}
          options={[
            { value: '', label: t('element.none') },
            ...elements.map((el) => ({ value: el.name, label: el.label })),
          ]}
        />
      </Field>
      {!candidates.length && <p className="m-0 text-xs text-err">{t('tools.noModel')}</p>}
    </>
  );
}

function ToolForm({ tool, e, onRun }: { tool: ToolDef; e: ManifestEntry; onRun: () => void }) {
  const { t } = useTranslation();
  const models = useData((s) => s.models);
  const status = useData((s) => s.status);
  const privacy = useSettings((s) => s.privacy);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(tool.fields.filter((f) => f.def).map((f) => [f.key, f.def as string])),
  );
  const candidates = toolModels(models, tool.id, privacy);
  const [model, setModel] = useState(preferredModel(candidates, [e.model, status?.defaultModel])?.id ?? '');
  const [element, setElement] = useState(e.element ?? '');

  const run = () => {
    if (!e.file) return;
    onRun();
    const ai = tool.ai ? { model, element: element || null } : { element: null };
    runTool({ tool: tool.id, source: e.file, ...ai, options: values }, tool.label);
  };

  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-panel-2 p-2.5">
      <p className="m-0 text-xs text-muted">{tool.hint}</p>
      {tool.fields.map((f) => (
        <ToolOption
          key={f.key}
          field={f}
          value={values[f.key] ?? ''}
          onChange={(v) => setValues({ ...values, [f.key]: v })}
        />
      ))}
      {tool.ai && (
        <AiToolOptions
          candidates={candidates}
          model={model}
          setModel={setModel}
          element={element}
          setElement={setElement}
        />
      )}
      <Button variant="primary" disabled={tool.ai && !model} onClick={run}>
        {t('tools.run', { tool: tool.label })}
      </Button>
    </div>
  );
}
