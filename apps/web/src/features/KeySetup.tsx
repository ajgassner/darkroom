import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';
import { errorMessage, saveApiKey } from '@/lib/actions';
import { useData } from '@/lib/store';
import { Splash } from './LoadingScreen';

/** First start without an OpenRouter key: asks for it and stores it in the data folder's .env. */
export function KeySetup() {
  const { t } = useTranslation();
  const envFile = useData((s) => s.status?.envFile ?? '.env');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveApiKey(key);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Splash>
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-3">
        <h1 className="text-base font-semibold">{t('setup.title')}</h1>
        <p className="text-sm text-muted">
          {t('setup.intro')}{' '}
          <a
            href="https://openrouter.ai/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent-2 hover:underline"
          >
            {t('setup.getKey')}
          </a>
        </p>
        <Input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label={t('setup.title')}
          placeholder={t('setup.placeholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={busy || !key.trim()}>
          {busy ? t('setup.checking') : t('setup.save')}
        </Button>
        <p className="text-xs break-all text-muted">{t('setup.stored', { file: envFile })}</p>
      </form>
    </Splash>
  );
}
