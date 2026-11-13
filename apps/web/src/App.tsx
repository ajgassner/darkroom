import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { KeySetup } from '@/features/app/KeySetup';
import { LoadingScreen } from '@/features/app/LoadingScreen';
import { Topbar } from '@/features/app/Topbar';
import { AudioPanel } from '@/features/audio/AudioPanel';
import { Composer } from '@/features/Composer';
import { DebugDialog } from '@/features/dialogs/DebugDialog';
import { ElementsDialog } from '@/features/dialogs/ElementsDialog';
import { PasteDialog, usePasteHandler } from '@/features/dialogs/PasteDialog';
import { VoicesDialog } from '@/features/dialogs/VoicesDialog';
import { Gallery } from '@/features/gallery/Gallery';
import { Lightbox } from '@/features/gallery/Lightbox';
import { useMediaQuery } from '@/features/hooks/useMediaQuery';
import { usePanelNotes } from '@/features/hooks/usePanelNotes';
import { ImagePanel } from '@/features/image/ImagePanel';
import { NoteList } from '@/features/shared';
import { loadAll } from '@/lib/actions';
import { useData, useSettings, useUi } from '@/lib/store';
import { blockingNotes } from '@/lib/text/notes';
import { cn } from '@/lib/utils';

export function App() {
  const ready = useUi((s) => s.load.state === 'ready');
  const needsKey = useData((s) => s.status?.hasKey === false);
  usePasteHandler();
  useEffect(() => {
    void loadAll();
  }, []);

  if (!ready || needsKey) {
    return (
      <>
        {ready ? <KeySetup /> : <LoadingScreen />}
        <AppToaster />
      </>
    );
  }
  return <Studio />;
}

/** The loaded app: settings panel, composer and gallery, plus the dialogs. */
function Studio() {
  const mode = useSettings((s) => s.mode);
  const [dragOver, setDragOver] = useState(false);
  // Narrow screens: the prompt comes first and the settings fold away below it (instead of a long panel above it)
  const wide = useMediaQuery('(min-width: 768px)');
  const panel = mode === 'image' ? <ImagePanel /> : <AudioPanel />;
  return (
    <TooltipProvider>
      <Topbar />
      <div className="grid grid-cols-1 md:min-h-[calc(100vh-52px)] md:grid-cols-[340px_1fr]">
        {wide && (
          <aside className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-line bg-panel px-4 pt-3.5 pb-10">
            {panel}
          </aside>
        )}
        <main
          className={cn(
            'min-w-0 px-4 pt-[18px] pb-[60px] md:px-6 md:pt-1.5',
            dragOver && 'outline-2 -outline-offset-8 outline-accent outline-dashed',
          )}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes('Files')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = [...e.dataTransfer.files].filter(
              (f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name),
            );
            if (files.length) useUi.setState({ pasteFiles: files });
          }}
        >
          <Composer />
          {!wide && <CollapsibleSettings>{panel}</CollapsibleSettings>}
          <Gallery />
        </main>
      </div>
      <Lightbox />
      <ElementsDialog />
      <VoicesDialog />
      <DebugDialog />
      <PasteDialog />
      <AppToaster />
    </TooltipProvider>
  );
}

/**
 * Settings below the composer on narrow screens, folded away until opened. While folded, the blocking notes (no
 * usable model, missing sample, …) stay visible, since they are why Generate may be disabled.
 */
function CollapsibleSettings({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const blocking = blockingNotes(usePanelNotes());
  return (
    <section className="mt-1 rounded-[14px] border border-line bg-panel">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between rounded-[14px] px-3 py-2.5 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {t('layout.settings')}
        <ChevronDownIcon className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {!open && blocking.length > 0 && (
        <div className="px-3 pb-2.5">
          <NoteList notes={blocking} />
        </div>
      )}
      {open && (
        <div id={id} className="border-t border-line px-3 pt-3.5 pb-5">
          {children}
        </div>
      )}
    </section>
  );
}

function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: '!rounded-[10px] !border !border-line !bg-panel !text-text !shadow-2xl',
          error: '!border-err',
          description: '!text-muted',
        },
      }}
    />
  );
}
