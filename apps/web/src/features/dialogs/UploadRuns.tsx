import { ImageOffIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { deleteEntries, loadUploadRuns } from '@/lib/actions';
import { outUrl, uploadThumbUrl } from '@/lib/api';
import type { UploadInfo, UploadRun } from '@/lib/types';
import { focusLost } from '@/lib/ui/scroll';
import { listStateText } from '@/lib/ui/uploads';
import { cn } from '@/lib/utils';
import { useModelName } from '../hooks/useModelName';

/**
 * The runs that use an upload, in place of the dialog's footer: show one in the gallery, or delete it (after an
 * in-page question), so the upload can be deleted once no run uses it anymore.
 */
export function UploadRuns({
  id,
  upload,
  confirmRun,
  setConfirmRun,
  onClose,
  onShow,
  onDeleted,
  focusUpload,
}: {
  id: string;
  upload: UploadInfo;
  /** Run whose delete is being confirmed */
  confirmRun: string | null;
  setConfirmRun: (runId: string | null) => void;
  onClose: () => void;
  onShow: (runId: string) => void;
  /** A run was deleted: the upload's run count changes */
  onDeleted: () => Promise<void>;
  /** Move the focus to the upload's delete button (once no run uses it anymore) */
  focusUpload: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [runs, setRuns] = useUploadRuns(upload.file);
  const listRef = useRef<HTMLUListElement>(null);
  useFocusAfterQuestion(confirmRun, listRef);

  const remove = async (runId: string) => {
    if (!(await deleteEntries({ runId }, null))) return;
    const left = Array.isArray(runs) ? runs.filter((r) => r.runId !== runId) : [];
    setRuns(left);
    setConfirmRun(null);
    await onDeleted();
    // The last run is gone: the upload can be deleted now
    if (!left.length) requestAnimationFrame(focusUpload);
  };

  return (
    <section id={id} aria-labelledby={titleId} className="flex max-h-[45vh] min-h-0 flex-col border-t border-accent/60">
      <RunsHeader file={upload.file} titleId={titleId} onClose={onClose} />
      {Array.isArray(runs) && runs.length ? (
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-labelledby={titleId}
          className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto px-5 pb-3 outline-none"
        >
          {runs.map((r) => (
            <RunRow
              key={r.runId}
              run={r}
              confirming={confirmRun === r.runId}
              onShow={() => onShow(r.runId)}
              onAsk={() => setConfirmRun(r.runId)}
              onDelete={() => void remove(r.runId)}
              onCancel={() => setConfirmRun(null)}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 px-5 pb-3 text-[13px] text-muted">
          {listStateText(runs, {
            loading: t('common.loading'),
            failed: t('uploads.runsFailed'),
            empty: t('uploads.noRuns'),
          })}
        </p>
      )}
    </section>
  );
}

/** The runs using an upload (null: loading); the list can be changed after a delete. */
function useUploadRuns(file: string) {
  const [runs, setRuns] = useState<UploadRun[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    setRuns(null);
    void loadUploadRuns(file).then((r) => {
      if (live) setRuns(r ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, [file]);
  return [runs, setRuns] as const;
}

/** When the question about a run closes, the focus goes back to its delete button (or the list, when it is gone). */
function useFocusAfterQuestion(confirmRun: string | null, listRef: React.RefObject<HTMLUListElement | null>) {
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const prev = asked.current;
    asked.current = confirmRun;
    if (!prev || confirmRun || !focusLost()) return;
    const button = listRef.current?.querySelector<HTMLElement>(`[data-run-delete="${prev}"]`);
    (button ?? listRef.current)?.focus();
  }, [confirmRun, listRef]);
}

function RunsHeader({ file, titleId, onClose }: { file: string; titleId: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-5 pt-3 pb-2">
      <img src={uploadThumbUrl(file, 120)} alt="" className="size-10 rounded-md border border-line object-cover" />
      <h3 id={titleId} className="m-0 flex-1 text-[13px] font-medium">
        {t('uploads.runsTitle')}
      </h3>
      <button
        type="button"
        aria-label={t('uploads.hideRuns')}
        title={t('uploads.hideRuns')}
        onClick={onClose}
        className="grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-panel-2 outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

function RunRow({
  run,
  confirming,
  onShow,
  onAsk,
  onDelete,
  onCancel,
}: {
  run: UploadRun;
  confirming: boolean;
  onShow: () => void;
  onAsk: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const name = useModelName();
  const questionId = useId();
  const when = new Date(run.ts).toLocaleString(i18n.resolvedLanguage);
  return (
    <li
      className={cn(
        'grid grid-cols-[48px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-lg border bg-panel-2 p-2',
        confirming ? 'border-err' : 'border-line',
      )}
    >
      {run.file ? (
        <img
          src={outUrl(run.file)}
          alt=""
          loading="lazy"
          decoding="async"
          className="row-span-2 size-12 rounded-md object-cover"
        />
      ) : (
        <span
          title={t('uploads.noPreview')}
          className="row-span-2 grid size-12 place-items-center rounded-md border border-line text-muted"
        >
          <ImageOffIcon className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="line-clamp-2 text-[13px] break-words">{run.prompt}</div>
        <div className="mt-0.5 text-xs text-muted">{[when, ...run.models.map(name)].join(' · ')}</div>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label={t('uploads.deleteRun')}
          aria-describedby={questionId}
          className="flex flex-wrap items-center gap-2"
        >
          <p id={questionId} className="m-0 basis-full text-xs">
            {t('uploads.confirmRun')}
          </p>
          <Button size="sm" variant="danger" onClick={onDelete}>
            {t('common.delete')}
          </Button>
          <Button size="sm" autoFocus onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" aria-label={t('uploads.showRunLabel', { prompt: run.prompt })} onClick={onShow}>
            {t('uploads.showRun')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            data-run-delete={run.runId}
            aria-label={t('uploads.deleteRunLabel', { prompt: run.prompt })}
            onClick={onAsk}
          >
            {t('uploads.deleteRun')}
          </Button>
        </div>
      )}
    </li>
  );
}
