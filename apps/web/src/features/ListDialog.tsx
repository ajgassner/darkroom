import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/misc';
import { toastError } from '@/lib/actions';
import { newItem } from '@/lib/names';
import { cn } from '@/lib/utils';

export interface ListItem {
  key: string;
  label: ReactNode;
  count: number;
}

/** Two-pane dialog: list with "create" form on the left, editor on the right (elements, voices). */
export function ListDialog({
  open,
  onOpenChange,
  title,
  items,
  active,
  onSelect,
  newPlaceholder,
  createLabel,
  folder,
  onCreate,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: ListItem[];
  active: string | null;
  onSelect: (key: string) => void;
  newPlaceholder: string;
  createLabel: string;
  /** Data folder the items live in (refs, voices): new items get a subfolder named after the display name */
  folder: string;
  onCreate: (name: string, label: string) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="h-[86vh] w-[min(980px,96vw)]">
        <div className="grid h-full grid-cols-1 md:grid-cols-[230px_1fr]">
          <div className="overflow-y-auto border-r border-line px-3.5 py-[18px]">
            <DialogTitle>{title}</DialogTitle>
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                aria-current={active === it.key || undefined}
                onClick={() => onSelect(it.key)}
                className={cn(
                  'flex w-full cursor-pointer justify-between rounded-lg px-2.5 py-2 text-left hover:bg-panel-2',
                  active === it.key && 'bg-panel-2',
                )}
              >
                <span>{it.label}</span>
                <span className="text-muted">{it.count}</span>
              </button>
            ))}
            <CreateForm
              existing={items.map((it) => it.key)}
              folder={folder}
              placeholder={newPlaceholder}
              createLabel={createLabel}
              onCreate={onCreate}
            />
          </div>
          <div className="flex flex-col gap-3.5 overflow-y-auto px-5 pt-12 pb-5">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Name field for a new item: shows the folder the typed display name becomes, or why it can't be used. */
function CreateForm({
  existing,
  folder,
  placeholder,
  createLabel,
  onCreate,
}: {
  existing: string[];
  folder: string;
  placeholder: string;
  createLabel: string;
  onCreate: (name: string, label: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const [value, setValue] = useState('');
  const item = newItem(value, existing);
  const { hint } = item;
  const create = async () => {
    if (!item.ok) return;
    try {
      await onCreate(item.name, item.label);
      setValue('');
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <form
        className="mt-3.5 flex gap-1.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          void create();
        }}
      >
        <Input
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={hint?.invalid}
          aria-describedby={hint ? hintId : undefined}
        />
        <Button type="submit" disabled={!item.ok}>
          {createLabel}
        </Button>
      </form>
      {hint && (
        <p
          id={hintId}
          aria-live="polite"
          className={cn('mt-1.5 text-xs [overflow-wrap:anywhere]', hint.invalid ? 'text-err' : 'text-muted')}
        >
          {t(hint.key, { path: `${folder}/${item.name}/` })}
        </p>
      )}
    </>
  );
}
