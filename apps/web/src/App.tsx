import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { AudioPanel } from '@/features/audio/AudioPanel';
import { Composer } from '@/features/Composer';
import { DebugDialog } from '@/features/DebugDialog';
import { ElementsDialog } from '@/features/ElementsDialog';
import { Gallery } from '@/features/Gallery';
import { ImagePanel } from '@/features/image/ImagePanel';
import { KeySetup } from '@/features/KeySetup';
import { Lightbox } from '@/features/Lightbox';
import { LoadingScreen } from '@/features/LoadingScreen';
import { PasteDialog, usePasteHandler } from '@/features/PasteDialog';
import { Topbar } from '@/features/Topbar';
import { VoicesDialog } from '@/features/VoicesDialog';
import { loadAll } from '@/lib/actions';
import { useData, useSettings, useUi } from '@/lib/store';
import { cn } from '@/lib/utils';

export function App() {
  const mode = useSettings((s) => s.mode);
  const ready = useUi((s) => s.load.state === 'ready');
  const needsKey = useData((s) => s.status?.hasKey === false);
  const [dragOver, setDragOver] = useState(false);
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

  return (
    <TooltipProvider>
      <Topbar />
      <div className="grid grid-cols-1 md:min-h-[calc(100vh-52px)] md:grid-cols-[340px_1fr]">
        <aside className="border-b border-line bg-panel px-4 pt-3.5 pb-10 md:sticky md:top-[52px] md:h-[calc(100vh-52px)] md:overflow-y-auto md:border-r md:border-b-0">
          {mode === 'image' ? <ImagePanel /> : <AudioPanel />}
        </aside>
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
