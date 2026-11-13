import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/actions';
import { api, outUrl } from '@/lib/api';
import { num } from '@/lib/format';
import { debugRows } from '@/lib/labels';
import { useUi } from '@/lib/store';
import type { DebugRecord, ManifestEntry } from '@/lib/types';
import { AudioPlayer } from './shared';

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const { t } = useTranslation();
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <details open className="rounded-[10px] border border-line">
      <summary className="flex cursor-pointer justify-between px-3 py-2 text-[13px] font-semibold">
        {title}
        <Button
          variant="link"
          onClick={(e) => {
            e.preventDefault();
            void navigator.clipboard?.writeText(text).then(() => toast.success(t('toast.copied')));
          }}
        >
          {t('common.copy')}
        </Button>
      </summary>
      <pre className="m-0 max-h-[420px] overflow-auto border-t border-line bg-panel-2 px-3 py-2.5 text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>
    </details>
  );
}

/** Load the recorded API call of an entry (null while loading or if the entry has none). */
function useDebugRecord(e: ManifestEntry | null) {
  const [record, setRecord] = useState<DebugRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRecord(null);
    setError(null);
    if (!e?.debugId) return;
    api<DebugRecord>(`/api/debug/${e.debugId}`)
      .then(setRecord)
      .catch((x) => setError(errorMessage(x)));
  }, [e]);
  return { record, error };
}

export function DebugDialog() {
  const { t } = useTranslation();
  const e = useUi((s) => s.debugEntry);
  const { record: d, error: err } = useDebugRecord(e);
  if (!e) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && useUi.setState({ debugEntry: null })}>
      <DialogContent closeLabel={t('common.close')} className="h-[90vh] w-[min(1100px,96vw)]">
        <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-[22px] pt-5 pb-7">
          <DialogTitle>{t('debug.title')}</DialogTitle>
          {err && <p className="text-xs text-err">{err}</p>}
          {!d && !err && <p className="text-muted">{t('common.loading')}</p>}
          {d && <DebugDetails e={e} d={d} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DebugDetails({ e, d }: { e: ManifestEntry; d: DebugRecord }) {
  const { t } = useTranslation();
  return (
    <>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
        {debugRows(t, e, d).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 break-words">{v}</dd>
          </div>
        ))}
        {d.error && (
          <div className="contents">
            <dt className="text-muted">{t('debug.error')}</dt>
            <dd className="m-0 break-words text-err">{d.error}</dd>
          </div>
        )}
      </dl>
      {d.sentFiles.length > 0 && <SentFiles files={d.sentFiles} />}
      {e.fullPrompt && <JsonBlock title={t('debug.sentPrompt')} value={e.fullPrompt} />}
      <JsonBlock title={t('debug.request')} value={d.request} />
      <JsonBlock title={t('debug.response')} value={d.response ?? t('debug.none')} />
      <JsonBlock title={t('debug.headers')} value={d.responseHeaders} />
    </>
  );
}

type SentFile = DebugRecord['sentFiles'][number];

function SentFiles({ files }: { files: SentFile[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="mt-1 mb-2 text-[13px] font-semibold">{t('debug.sentRefs')}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {files.map((f) => (
          <SentFileFigure key={f.index} f={f} />
        ))}
      </div>
    </div>
  );
}

function SentFileFigure({ f }: { f: SentFile }) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      {f.mime.startsWith('image/') ? (
        <a href={outUrl(f.file)} target="_blank" rel="noreferrer">
          <img
            src={outUrl(f.file)}
            alt=""
            className="checker aspect-square w-full rounded-lg border border-line object-contain"
          />
        </a>
      ) : (
        <AudioPlayer src={outUrl(f.file)} />
      )}
      <figcaption className="text-xs text-muted">
        #{f.index} · {f.mime.replace(/^(image|audio)\//, '')} · {f.width ? `${f.width}×${f.height} · ` : ''}
        {num(f.bytes / 1024)} KB
      </figcaption>
    </figure>
  );
}
