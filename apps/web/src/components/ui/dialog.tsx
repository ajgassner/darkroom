import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('section-title', className)} {...props} />;
}

/** Modal panel in the app style: dark panel, rounded, close button top-right. */
function DialogContent({
  className,
  children,
  closeLabel = 'Close',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  // Our dialogs open from store state, not from a Radix trigger, so Radix would put the focus on <body> when they
  // close. The element that had the focus when the dialog opened (still focused while Radix announces the open
  // autofocus) gets it back, as long as it is still on the page.
  const opener = useRef<HTMLElement | null>(null);
  const rememberOpener = (e: Event) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenAutoFocus?.(e);
  };
  const restoreFocus = (e: Event) => {
    onCloseAutoFocus?.(e);
    const el = opener.current;
    opener.current = null;
    if (e.defaultPrevented || !el?.isConnected || el === document.body) return;
    e.preventDefault();
    el.focus();
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] border border-line bg-panel text-text shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        onOpenAutoFocus={rememberOpener}
        onCloseAutoFocus={restoreFocus}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute top-2 right-2 z-10 grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-panel-2 hover:border-accent"
        >
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogContent, DialogTitle };
