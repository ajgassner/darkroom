import { CheckIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { deleteUpload, loadUploads } from '@/lib/actions';
import { uploadThumbUrl } from '@/lib/api';
import { useUi } from '@/lib/store';
import type { UploadInfo } from '@/lib/types';
import { focusLost, revealRun } from '@/lib/ui/scroll';
import {
  deleteLabel,
  hasOutRef,
  listStateText,
  panelAfterEscape,
  pickLabel,
  tileTone,
  tileView,
  toggleOutRef,
  toggleRuns,
  type UploadPanel,
  usageText,
} from '@/lib/ui/uploads';
import { cn } from '@/lib/utils';
import { UploadRuns } from './UploadRuns';

const TONE = { err: 'border-err', accent: 'border-accent', line: 'border-line' } as const;

/** Previous uploads (out/uploads/): pick them again as additional references, see the runs using them, delete them. */
export function UploadsDialog() {
  const { t } = useTranslation();
  const open = useUi((s) => s.uploadsOpen);
  // Escape closes the innermost question or panel first instead of the dialog
  const [panel, setPanel] = useState<UploadPanel | null>(null);
  // Run to show in the gallery once the dialog has closed (and Radix is done with the focus)
  const showing = useRef<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        useUi.setState({ uploadsOpen: o });
        setPanel(null);
      }}
    >
      <DialogContent
        closeLabel={t('common.close')}
        className="flex max-h-[86vh] w-[min(760px,calc(100vw-32px))] flex-col"
        onEscapeKeyDown={(e) => {
          if (!panel) return;
          e.preventDefault();
          setPanel(panelAfterEscape(panel));
        }}
        onCloseAutoFocus={(e) => {
          const runId = showing.current;
          showing.current = null;
          if (!runId) return;
          e.preventDefault();
          if (!revealRun(runId)) toast.info(t('uploads.runNotShown'));
        }}
      >
        <div className="px-5 pt-[18px] pr-12">
          <DialogTitle>{t('uploads.title')}</DialogTitle>
          <p className="mt-1 mb-0 text-xs text-muted">{t('uploads.hint')}</p>
        </div>
        <UploadsBody
          panel={panel}
          setPanel={setPanel}
          onShowRun={(runId) => {
            showing.current = runId;
            useUi.setState({ uploadsOpen: false });
            setPanel(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Focus the button of an upload that opened a panel (delete or runs), or the list when that upload is gone. */
function focusOpener(list: HTMLElement | null, file: string, view: UploadPanel['view']) {
  const buttons = [...(list?.querySelectorAll<HTMLElement>(`[data-${view}]`) ?? [])];
  (buttons.find((b) => b.dataset[view] === file) ?? list)?.focus();
}

/** Uploads, loaded fresh each time the dialog opens; `reload` updates the run counts (null: loading). */
function useUploads() {
  const [uploads, setUploads] = useState<UploadInfo[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    void loadUploads().then((u) => {
      if (live) setUploads(u ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, []);
  const reload = async () => {
    const u = await loadUploads();
    if (u) setUploads(u);
  };
  const drop = (file: string) =>
    setUploads((list) => (Array.isArray(list) ? list.filter((x) => x.file !== file) : list));
  return { uploads, reload, drop };
}

/** Grid and bottom bar; mounted only while the dialog is open. */
function UploadsBody({
  panel,
  setPanel,
  onShowRun,
}: {
  panel: UploadPanel | null;
  setPanel: (p: UploadPanel | null) => void;
  onShowRun: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const { uploads, reload, drop } = useUploads();
  const listRef = useRef<HTMLUListElement>(null);
  const panelId = useId();

  // When a panel closes, its focused button is gone: the focus goes back to the button it came from (or to the
  // list, when that upload was deleted)
  const opened = useRef<UploadPanel | null>(null);
  useEffect(() => {
    const prev = opened.current;
    opened.current = panel;
    if (prev && !panel && focusLost()) focusOpener(listRef.current, prev.file, prev.view);
  }, [panel]);

  const list = Array.isArray(uploads) ? uploads : [];
  const current = list.find((u) => u.file === panel?.file);

  return (
    <>
      {list.length ? (
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-label={t('uploads.title')}
          // Rows as high as their tiles: the grid scrolls instead of squeezing them (the tiles clip their corners)
          className="m-0 grid min-h-0 list-none auto-rows-max grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5 overflow-y-auto px-5 py-4 outline-none"
        >
          {list.map((u) => (
            <UploadTile
              key={u.file}
              upload={u}
              view={tileView(panel, u.file)}
              panelId={panelId}
              onDelete={() => setPanel({ file: u.file, view: 'delete' })}
              onRuns={() => setPanel(toggleRuns(panel, u.file))}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 px-5 py-8 text-center text-[13px] text-muted">
          {listStateText(uploads, {
            loading: t('common.loading'),
            failed: t('uploads.failed'),
            empty: t('uploads.empty'),
          })}
        </p>
      )}
      {current && panel ? (
        <PanelFor
          upload={current}
          panel={panel}
          panelId={panelId}
          setPanel={setPanel}
          onShowRun={onShowRun}
          onUploadDeleted={() => drop(current.file)}
          onRunDeleted={reload}
          focusUpload={() => focusOpener(listRef.current, current.file, 'delete')}
        />
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

/** The open panel of an upload, in place of the footer: the question before deleting it, or its runs. */
function PanelFor({
  upload,
  panel,
  panelId,
  setPanel,
  onShowRun,
  onUploadDeleted,
  onRunDeleted,
  focusUpload,
}: {
  upload: UploadInfo;
  panel: UploadPanel;
  panelId: string;
  setPanel: (p: UploadPanel | null) => void;
  onShowRun: (runId: string) => void;
  onUploadDeleted: () => void;
  onRunDeleted: () => Promise<void>;
  focusUpload: () => void;
}) {
  if (panel.view === 'delete') {
    return (
      <ConfirmBar
        upload={upload}
        onDelete={async () => {
          if (!(await deleteUpload(upload.file))) return;
          onUploadDeleted();
          setPanel(null);
        }}
        onCancel={() => setPanel(null)}
      />
    );
  }
  return (
    <UploadRuns
      id={panelId}
      upload={upload}
      confirmRun={panel.confirmRun}
      setConfirmRun={(confirmRun) => setPanel({ ...panel, confirmRun })}
      onClose={() => setPanel(null)}
      onShow={onShowRun}
      onDeleted={onRunDeleted}
      focusUpload={focusUpload}
    />
  );
}

function UploadTile({
  upload: u,
  view,
  panelId,
  onDelete,
  onRuns,
}: {
  upload: UploadInfo;
  /** The panel open for this upload, if any */
  view: UploadPanel['view'] | null;
  panelId: string;
  onDelete: () => void;
  onRuns: () => void;
}) {
  const { t } = useTranslation();
  const picked = useUi((s) => hasOutRef(s.extraRefs, u.file));
  return (
    <li
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-panel-2',
        TONE[tileTone(view, picked)],
      )}
    >
      <button
        type="button"
        aria-pressed={picked}
        aria-label={pickLabel(t, u, picked)}
        title={u.file}
        onClick={() => useUi.setState((s) => ({ extraRefs: toggleOutRef(s.extraRefs, u.file) }))}
        className="block w-full cursor-pointer p-0 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
      >
        <img
          src={uploadThumbUrl(u.file)}
          alt=""
          loading="lazy"
          decoding="async"
          className="block aspect-square w-full object-cover"
        />
      </button>
      <Usage upload={u} picked={picked} expanded={view === 'runs'} panelId={panelId} onRuns={onRuns} />
      {picked && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-accent">
          <CheckIcon className="size-3 text-white" strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        data-delete={u.file}
        aria-label={deleteLabel(t, u)}
        aria-expanded={view === 'delete'}
        title={deleteLabel(t, u)}
        disabled={u.runs > 0}
        onClick={onDelete}
        className="absolute top-1 right-1 grid size-7 cursor-pointer place-items-center rounded-full border border-line bg-panel/90 outline-none hover:border-err focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </li>
  );
}

/** "used in N runs" under an upload: a button that shows those runs; "unused" or "added" otherwise. */
function Usage({
  upload: u,
  picked,
  expanded,
  panelId,
  onRuns,
}: {
  upload: UploadInfo;
  picked: boolean;
  expanded: boolean;
  panelId: string;
  onRuns: () => void;
}) {
  const { t } = useTranslation();
  if (!u.runs) {
    return (
      <span className={cn('block truncate px-2 py-1 text-[11px]', picked ? 'text-accent-2' : 'text-muted')}>
        {picked ? t('uploads.picked') : usageText(t, u)}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-runs={u.file}
      aria-expanded={expanded}
      aria-controls={expanded ? panelId : undefined}
      aria-label={t('uploads.showRuns', { count: u.runs })}
      onClick={onRuns}
      className="block w-full cursor-pointer truncate px-2 py-1 text-left text-[11px] text-accent-2 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
    >
      {usageText(t, u)}
    </button>
  );
}

/** In-page question before an upload is deleted, in place of the footer (with the upload's thumbnail). */
function ConfirmBar({
  upload,
  onDelete,
  onCancel,
}: {
  upload: UploadInfo;
  onDelete: () => Promise<void>;
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
        {t('uploads.confirm')}
      </p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={() => void onDelete()}>
          {t('common.delete')}
        </Button>
        <Button autoFocus onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
