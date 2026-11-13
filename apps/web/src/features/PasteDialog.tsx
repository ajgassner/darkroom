import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { addExtraFiles, importImages, uploadPhotos } from '@/lib/actions';
import { useSettings, useUi } from '@/lib/store';

/** Files from the clipboard (screenshots, "copy image" in the browser). */
function clipboardImages(e: ClipboardEvent): File[] {
  const files = [...(e.clipboardData?.items ?? [])]
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => Boolean(f));
  const stamp = new Date().toLocaleTimeString().replace(/:/g, '-');
  return files.map(
    (f, i) =>
      new File([f], `pasted_${stamp}${files.length > 1 ? `_${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, {
        type: f.type,
      }),
  );
}

/** Global ⌘V handler: into the element dialog as element photos, otherwise ask what to do. */
export function usePasteHandler() {
  const { t } = useTranslation();
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = clipboardImages(e);
      if (!files.length) return;
      e.preventDefault();
      const ui = useUi.getState();
      if (ui.elementsOpen) {
        if (ui.editingElement) void uploadPhotos(ui.editingElement, files);
        else toast.error(t('toast.selectElementFirst'));
        return;
      }
      useUi.setState({ lightbox: null, pasteFiles: files });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [t]);
}

export function PasteDialog() {
  const { t } = useTranslation();
  const files = useUi((s) => s.pasteFiles);
  const urls = useMemo(() => (files ?? []).map((f) => URL.createObjectURL(f)), [files]);
  useEffect(
    () => () => {
      for (const u of urls) URL.revokeObjectURL(u);
    },
    [urls],
  );
  if (!files) return null;
  const close = () => useUi.setState({ pasteFiles: null });

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent closeLabel={t('common.close')} className="w-[min(460px,92vw)]">
        <div className="flex flex-col gap-3 p-[18px]">
          <div className="flex flex-wrap gap-1.5">
            {urls.map((u) => (
              <img key={u} src={u} alt="" className="block size-[52px] rounded-md border border-line object-cover" />
            ))}
          </div>
          <DialogTitle className="m-0 text-sm font-normal tracking-normal text-text normal-case">
            {t('paste.question')}
          </DialogTitle>
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              onClick={() => {
                close();
                void importImages(files);
              }}
            >
              {t('paste.tools')}
            </Button>
            <Button
              onClick={async () => {
                close();
                useSettings.getState().set({ mode: 'image' });
                const n = await addExtraFiles(files);
                if (n) toast.success(t('toast.refsAdded', { count: n }));
              }}
            >
              {t('paste.reference')}
            </Button>
            <Button variant="link" className="self-center text-[13px]" onClick={close}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
