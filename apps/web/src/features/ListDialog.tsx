import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/misc';
import { errorMessage } from '@/lib/actions';
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
  onCreate: (name: string) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await onCreate(name);
      setNewName('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

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
            <form
              className="mt-3.5 flex gap-1.5"
              onSubmit={(ev) => {
                ev.preventDefault();
                void create();
              }}
            >
              <Input
                value={newName}
                onChange={(ev) => setNewName(ev.target.value)}
                placeholder={newPlaceholder}
                pattern="[A-Za-z0-9_\-][A-Za-z0-9_.\-]{0,63}"
                required
              />
              <Button type="submit">{createLabel}</Button>
            </form>
          </div>
          <div className="flex flex-col gap-3.5 overflow-y-auto px-5 pt-12 pb-5">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
