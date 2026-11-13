import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { loadAll } from '@/lib/actions';
import { useUi } from '@/lib/store';

/** Shown instead of the app until the initial data is loaded, or with a retry if loading failed. */
export function LoadingScreen() {
  const { t } = useTranslation();
  const load = useUi((s) => s.load);

  return (
    <Splash>
      {load.state === 'failed' ? (
        <>
          <div className="max-w-md space-y-1.5">
            <p className="text-err">{t('boot.failed')}</p>
            <p className="text-sm break-words text-muted">{load.error}</p>
            <p className="text-sm text-muted">{t('boot.hint')}</p>
          </div>
          <Button variant="primary" onClick={() => void loadAll()}>
            {t('boot.retry')}
          </Button>
        </>
      ) : (
        // Fades in with a short delay, so a fast local load does not flash the spinner
        <div
          role="status"
          className="flex flex-col items-center gap-3 animate-in fade-in-0 duration-300 [animation-delay:200ms] [animation-fill-mode:both]"
        >
          <Spinner />
          <p className="text-sm text-muted">{t('boot.loading')}</p>
        </div>
      )}
    </Splash>
  );
}

/** Full-screen, centered frame for the screens shown before the app (loading, key setup). */
export function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="/favicon.svg" alt="" className="size-14" />
      <div className="-mt-2 text-lg font-semibold tracking-tight">darkroom</div>
      {children}
    </div>
  );
}
