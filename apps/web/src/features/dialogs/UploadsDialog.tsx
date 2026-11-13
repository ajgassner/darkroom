import { CheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { deleteUpload, loadUploads } from '@/lib/actions';
import { uploadThumbUrl } from '@/lib/api';
import { useUi } from '@/lib/store';
import type { UploadInfo } from '@/lib/types';
import { deleteQuestion, hasOutRef, pickLabel, toggleOutRef, usageText } from '@/lib/ui/uploads';
import { cn } from '@/lib/utils';

/** Previous uploads (out/uploads/): pick them again as additional references, or delete them. */
export function UploadsDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.uploadsOpen);
  // Upload whose delete is being confirmed: Escape cancels that first instead of closing the dialog
  const [confirming, setConfirming] = useState<UploadInfo | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        useUi.setState({ uploadsOpen: o });
        setConfirming(null);
      }}
    >
      <DialogContent
        closeLabel={t('common.close')}
        className="flex max-h-[86vh] w-[min(760px,calc(100vw-32px))] flex-col"
        onEscapeKeyDown={(e) => {
          if (!confirming) return;
          e.preventDefault();
          setConfirming(null);
        }}
      >
        <div className="px-5 pt-[18px] pr-12">
          <DialogTitle>{t('uploads.title')}</DialogTitle>
          <p className="mt-1 mb-0 text-xs text-muted">{t('uploads.hint')}</p>
        </div>
        <UploadsBody confirming={confirming} setConfirming={setConfirming} />
      </DialogContent>
    </Dialog>
  );
}

const focusLost = () => !document.activeElement || document.activeElement === document.body;

/** Focus the delete button of an upload, or the list when that upload is gone. */
function focusTrash(list: HTMLElement | null, file: string) {
  const buttons = [...(list?.querySelectorAll<HTMLElement>('[data-trash]') ?? [])];
  (buttons.find((b) => b.dataset.trash === file) ?? list)?.focus();
}

/** Grid and footer; mounted only while the dialog is open, so the uploads are loaded fresh each time. */
function UploadsBody({
  confirming,
  setConfirming,
}: {
  confirming: UploadInfo | null;
  setConfirming: (u: UploadInfo | null) => void;
}) {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<UploadInfo[] | null | 'failed'>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    let live = true;
    void loadUploads().then((u) => {
      if (live) setUploads(u ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, []);

  // When the question closes, its focused button is gone: the focus goes back to the delete button it came from
  // (or to the list, when that upload was deleted)
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const prev = asked.current;
    asked.current = confirming?.file ?? null;
    if (prev && !confirming && focusLost()) focusTrash(listRef.current, prev);
  }, [confirming]);

  const remove = async (u: UploadInfo) => {
    if (!(await deleteUpload(u.file))) return;
    setUploads((list) => (Array.isArray(list) ? list.filter((x) => x.file !== u.file) : list));
    setConfirming(null);
  };

  return (
    <>
      {Array.isArray(uploads) && uploads.length > 0 ? (
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-label={t('uploads.title')}
          className="m-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5 overflow-y-auto px-5 py-4 outline-none"
        >
          {uploads.map((u) => (
            <UploadTile
              key={u.file}
              upload={u}
              confirming={confirming?.file === u.file}
              onDelete={() => setConfirming(u)}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 px-5 py-8 text-center text-[13px] text-muted">
          {uploads === null ? t('common.loading') : uploads === 'failed' ? t('uploads.failed') : t('uploads.empty')}
        </p>
      )}
      {confirming ? (
        <ConfirmBar upload={confirming} onDelete={() => void remove(confirming)} onCancel={() => setConfirming(null)} />
      ) : (
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button variant="primary" onClick={() => useUi.setState({ uploadsOpen: false })}>
            {t('uploads.done')}
          </Button>
        </div>
      )}
    </>
  );
}

function UploadTile({
  upload: u,
  confirming,
  onDelete,
}: {
  upload: UploadInfo;
  confirming: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const picked = useUi((s) => hasOutRef(s.extraRefs, u.file));
  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={picked}
        aria-label={pickLabel(t, u, picked)}
        title={u.file}
        onClick={() => useUi.setState((s) => ({ extraRefs: toggleOutRef(s.extraRefs, u.file) }))}
        className={cn(
          'block w-full cursor-pointer overflow-hidden rounded-lg border bg-panel-2 p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          confirming ? 'border-err' : picked ? 'border-accent' : 'border-line hover:border-accent',
        )}
      >
        <img
          src={uploadThumbUrl(u.file)}
          alt=""
          loading="lazy"
          decoding="async"
          className="block aspect-square w-full object-cover"
        />
        <span className={cn('block truncate px-2 py-1 text-[11px]', picked ? 'text-accent-2' : 'text-muted')}>
          {picked ? t('uploads.picked') : usageText(t, u)}
        </span>
      </button>
      {picked && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-accent">
          <CheckIcon className="size-3 text-white" strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        data-trash={u.file}
        aria-label={t('uploads.delete')}
        aria-expanded={confirming}
        title={t('uploads.delete')}
        onClick={onDelete}
        className="absolute top-1 right-1 grid size-7 cursor-pointer place-items-center rounded-full border border-line bg-panel/90 outline-none hover:border-err focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </li>
  );
}

/** In-page question before an upload is deleted, in place of the footer (with the upload's thumbnail). */
function ConfirmBar({
  upload,
  onDelete,
  onCancel,
}: {
  upload: UploadInfo;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div
      role="alertdialog"
      aria-label={t('uploads.delete')}
      aria-describedby={id}
      className="flex flex-wrap items-center gap-3 border-t border-err/60 px-5 py-3"
    >
      <img
        src={uploadThumbUrl(upload.file, 120)}
        alt=""
        className="size-10 rounded-md border border-line object-cover"
      />
      <p id={id} className="m-0 min-w-[12rem] flex-1 text-[13px]">
        {deleteQuestion(t, upload)}
      </p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onDelete}>
          {t('common.delete')}
        </Button>
        <Button autoFocus onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
