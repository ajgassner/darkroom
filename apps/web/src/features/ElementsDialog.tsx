import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { deleteElement, errorMessage, reloadElements, uploadPhotos } from '@/lib/actions';
import { api } from '@/lib/api';
import { useData, useSettings, useUi } from '@/lib/store';
import type { ElementInfo, ElementType } from '@/lib/types';
import { ListDialog } from './ListDialog';
import { DropZone, ElementThumb } from './shared';

const TYPES: ElementType[] = ['person', 'logo', 'object', 'location', 'style'];
const HINT = {
  person: 'hintPerson',
  logo: 'hintLogo',
  object: 'hintObject',
  location: 'hintLocation',
  style: 'hintStyle',
} as const;
const PLACEHOLDER = {
  person: 'phPerson',
  logo: 'phLogo',
  object: 'phObject',
  location: 'phLocation',
  style: 'phStyle',
} as const;
const isTemplate = (s: string) => s.includes('{prompt}');

export function ElementsDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.elementsOpen);
  const editing = useUi((s) => s.editingElement);
  const elements = useData((s) => s.elements);
  const el = elements.find((e) => e.name === editing);

  return (
    <ListDialog
      open={open}
      onOpenChange={(o) => useUi.setState({ elementsOpen: o })}
      title={t('elements.title')}
      items={elements.map((e) => ({
        key: e.name,
        count: e.photos.length,
        label: (
          <>
            @{e.name}
            <span className="text-xs text-muted"> · {t(`types.${e.type}`)}</span>
          </>
        ),
      }))}
      active={editing}
      onSelect={(name) => useUi.setState({ editingElement: name })}
      newPlaceholder={t('elements.newPlaceholder')}
      createLabel={t('elements.create')}
      folder="refs"
      onCreate={async (name, label) => {
        await api('/api/elements', { body: { name, label } });
        await reloadElements();
        useUi.setState({ editingElement: name });
        const s = useSettings.getState();
        if (!s.element) s.set({ element: name });
      }}
    >
      {el ? <ElementEditor key={el.name} el={el} /> : <p className="text-muted">{t('elements.empty')}</p>}
    </ListDialog>
  );
}

function ElementEditor({ el }: { el: ElementInfo }) {
  const { t } = useTranslation();
  const defaultInstructions = useData((s) => s.status?.defaultInstructions ?? '');
  const [label, setLabel] = useState(el.label);
  const [type, setType] = useState<ElementType>(el.type);
  const [instr, setInstr] = useState(el.instructions);

  const save = async () => {
    try {
      await api(`/api/elements/${encodeURIComponent(el.name)}`, {
        method: 'PUT',
        body: { label, type, instructions: instr },
      });
      await reloadElements();
      toast.success(t('toast.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removePhoto = async (f: string) => {
    if (!window.confirm(t('elements.deletePhoto', { file: f }))) return;
    try {
      await api(`/api/elements/${encodeURIComponent(el.name)}/photos/${encodeURIComponent(f)}`, { method: 'DELETE' });
      await reloadElements();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <h2 className="section-title">{t('elements.header', { name: el.name, count: el.photos.length })}</h2>
      <div className="flex items-end gap-2">
        <Field label={t('elements.displayName')} className="flex-1">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('elements.type')}>
          <Select
            value={type}
            onValueChange={(v) => {
              const next = v as ElementType;
              // The person template does not fit other types: clear it on switch
              if (next !== 'person' && isTemplate(instr)) setInstr('');
              setType(next);
            }}
            options={TYPES.map((k) => ({ value: k, label: t(`types.${k}`) }))}
          />
        </Field>
      </div>
      <p className="m-0 text-xs text-muted">{t(`elements.${HINT[type]}`)}</p>
      <Field label={type === 'person' && isTemplate(instr) ? t('elements.instrTemplate') : t('elements.instrOptional')}>
        <Textarea
          rows={type === 'person' && isTemplate(instr) ? 8 : 3}
          value={instr}
          placeholder={t(`elements.${PLACEHOLDER[type]}`)}
          onChange={(e) => setInstr(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save()}>
          {t('common.save')}
        </Button>
        {type === 'person' && (
          <Button onClick={() => setInstr(defaultInstructions)}>{t('elements.defaultTemplate')}</Button>
        )}
        <Button variant="danger" className="ml-auto" onClick={() => void deleteElement(el)}>
          {t('elements.delete')}
        </Button>
      </div>
      <DropZone
        label={t('elements.drop')}
        accept="image/*,.heic,.heif"
        onFiles={(files) => void uploadPhotos(el.name, files)}
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2.5">
        {el.photos.map((f) => (
          <div key={f} className="relative">
            <ElementThumb el={el} file={f} size={240} className="!h-auto !w-full aspect-square" />
            <button
              type="button"
              aria-label={t('common.delete')}
              onClick={() => void removePhoto(f)}
              className="absolute -top-1.5 -right-1.5 grid size-5 cursor-pointer place-items-center rounded-full border border-line bg-panel hover:border-err"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
