import { StarIcon } from 'lucide-react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Tooltip } from '@/components/ui/misc';
import { toggleFavorite } from '@/lib/actions';
import { isNewModel, releaseMonth } from '@/lib/models/models';
import type { ModelKind } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Model name with its release month (muted) and a "new" badge for models released in the last 30 days. */
function ModelTitle({ name, created }: { name: React.ReactNode; created?: number }) {
  const { t, i18n } = useTranslation();
  const month = releaseMonth(created, i18n.resolvedLanguage ?? 'en');
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] [overflow-wrap:anywhere]">
      <span>{name}</span>
      {month && <span className="text-[11px] whitespace-nowrap text-muted">{month}</span>}
      {isNewModel(created) && (
        <Tooltip content={t('models.newHint')}>
          <Tag tone="ok" className="self-center">
            {t('models.new')}
          </Tag>
        </Tooltip>
      )}
    </div>
  );
}

/** Star toggle that adds a model to the favorites or removes it (saved on the server, shared with the CLI). */
export function FavoriteStar({ kind, id, favorite }: { kind: ModelKind; id: string; favorite: boolean }) {
  const { t } = useTranslation();
  const label = favorite ? t('models.favoriteRemove') : t('models.favoriteAdd');
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-pressed={favorite}
        aria-label={label}
        onClick={() => void toggleFavorite(kind, id, !favorite)}
        className={cn(
          'grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-panel hover:text-text focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none',
          favorite && 'text-warn hover:text-warn',
        )}
      >
        <StarIcon className={cn('size-3.5', favorite && 'fill-current')} />
      </button>
    </Tooltip>
  );
}

/**
 * Content of a model entry, the same for image, speech and music: title (with release month and "new"), model id,
 * a muted capability line, the list price (accent) and the tags on the right (ZDR, cloning, …).
 */
export function ModelCardBody({
  control,
  name,
  created,
  id,
  capabilities,
  price,
  tags,
}: {
  control: React.ReactNode;
  name: React.ReactNode;
  created?: number;
  id: string;
  capabilities?: React.ReactNode;
  price: React.ReactNode;
  tags: React.ReactNode;
}) {
  return (
    <>
      {control}
      <div className="min-w-0">
        <ModelTitle name={name} created={created} />
        <div className="mt-px text-[11px] leading-[1.35] text-muted [overflow-wrap:anywhere]">{id}</div>
        {capabilities && <div className="text-[11px] leading-[1.35] text-muted">{capabilities}</div>}
        <div className="mt-0.5 text-[11px] leading-[1.35] text-accent-2">{price}</div>
      </div>
      <div className="flex flex-col items-end gap-[3px]">{tags}</div>
    </>
  );
}

/** Frame of a model entry: the entry itself (checkbox label or radio button) and the favorite star next to it. */
export function ModelRow({
  checked,
  blocked = false,
  favorite,
  children,
}: {
  checked: boolean;
  blocked?: boolean;
  favorite: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-1 rounded-lg border border-transparent pr-1 hover:bg-panel-2',
        checked && 'border-line bg-panel-2',
        blocked && 'opacity-45',
      )}
    >
      {children}
      <div className="pt-1">{favorite}</div>
    </div>
  );
}
