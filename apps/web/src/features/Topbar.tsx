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
  const set = useSettings((s) => s.set);
  const status = useData((s) => s.status);
  const update = useData((s) => s.update);

  return (
    // One row of 52 px from md on (the side panel and the composer stick below it); narrower screens wrap
    <header
      data-sticky
      className="sticky top-0 z-10 flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2 md:h-[52px] md:flex-nowrap md:py-0"
    >
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
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
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
        <PrivacySelect />
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
              'hidden rounded-full border px-2 py-[3px] text-xs whitespace-nowrap lg:inline',
              status.hasKey ? 'border-ok/40 text-ok' : 'border-err/40 text-err',
            )}
          >
            {status.hasKey ? t('topbar.keyOk') : t('topbar.keyMissing')}
          </span>
        )}
        {status && (
          <span className="font-semibold whitespace-nowrap tabular-nums" title={t('topbar.totalCostHint')}>
            {t('topbar.totalCost', { cost: usd(status.costs.total), count: status.costs.images })}
          </span>
        )}
      </div>
    </header>
  );
}

/** Privacy mode: the full name on wide screens, a short one in the button below that (the list stays complete). */
function PrivacySelect() {
  const { t } = useTranslation();
  const privacy = useSettings((s) => s.privacy);
  const set = useSettings((s) => s.set);
  const labels = {
    zdr: [t('topbar.privacyZdr'), t('topbar.privacyZdrShort')],
    'zdr-strict': [t('topbar.privacyStrict'), t('topbar.privacyStrictShort')],
    off: [t('topbar.privacyOff'), t('topbar.privacyOffShort')],
  } satisfies Record<PrivacyMode, [string, string]>;
  const [full, short] = labels[privacy] ?? labels.zdr;
  return (
    <div className="flex items-center gap-2 text-xs text-muted" title={t('topbar.privacyHint')}>
      <span className="hidden lg:inline">{t('topbar.privacy')}</span>
      <Select
        ariaLabel={t('topbar.privacy')}
        className="w-auto py-1 text-xs"
        value={privacy}
        onValueChange={(v) => set({ privacy: v as PrivacyMode })}
        valueLabel={
          <>
            <span className="xl:hidden">{short}</span>
            <span className="hidden xl:inline">{full}</span>
          </>
        }
        options={Object.entries(labels).map(([value, [label]]) => ({ value, label }))}
      />
    </div>
  );
}
