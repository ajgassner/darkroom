import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { LANGUAGES, type Lang } from '@/i18n';
import { usd } from '@/lib/pricing';
import { useData, useSettings } from '@/lib/store';
import type { PrivacyMode } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Topbar() {
  const { t, i18n } = useTranslation();
  const mode = useSettings((s) => s.mode);
  const privacy = useSettings((s) => s.privacy);
  const set = useSettings((s) => s.set);
  const status = useData((s) => s.status);
  const update = useData((s) => s.update);

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-line bg-panel px-4">
      <div className="flex items-center gap-[22px]">
        <div className="flex items-center gap-2 font-bold tracking-[0.02em]">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span>
            dark<span className="font-semibold text-accent-2">room</span>
          </span>
        </div>
        <nav className="flex gap-1 rounded-[9px] border border-line bg-panel-2 p-[3px]">
          {(['image', 'audio'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set({ mode: m })}
              className={cn('cursor-pointer rounded-md px-3.5 py-1 text-[13px]', mode === m && 'bg-accent text-white')}
            >
              {t(`topbar.${m}`)}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {update && (
          <Tooltip content={t('topbar.updateHint', { command: update.command })}>
            <a
              href={update.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-accent/50 px-2 py-[3px] text-xs text-accent-2 hover:bg-accent/10"
            >
              {t('topbar.update', { version: update.version })}
            </a>
          </Tooltip>
        )}
        <div className="hidden items-center gap-2 text-xs text-muted md:flex" title={t('topbar.privacyHint')}>
          {t('topbar.privacy')}
          <Select
            ariaLabel={t('topbar.privacy')}
            className="w-auto py-1 text-xs"
            value={privacy}
            onValueChange={(v) => set({ privacy: v as PrivacyMode })}
            options={[
              { value: 'zdr', label: t('topbar.privacyZdr') },
              { value: 'zdr-strict', label: t('topbar.privacyStrict') },
              { value: 'off', label: t('topbar.privacyOff') },
            ]}
          />
        </div>
        <Select
          ariaLabel={t('topbar.language')}
          className="w-auto py-1 text-xs"
          value={(i18n.resolvedLanguage as Lang) ?? 'en'}
          onValueChange={(v) => void i18n.changeLanguage(v)}
          options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))}
        />
        {status && (
          <span
            className={cn(
              'rounded-full border px-2 py-[3px] text-xs',
              status.hasKey ? 'border-ok/40 text-ok' : 'border-err/40 text-err',
            )}
          >
            {status.hasKey ? t('topbar.keyOk') : t('topbar.keyMissing')}
          </span>
        )}
        {status && (
          <span className="font-semibold tabular-nums" title={t('topbar.totalCostHint')}>
            {t('topbar.totalCost', { cost: usd(status.costs.total), count: status.costs.images })}
          </span>
        )}
      </div>
    </header>
  );
}
