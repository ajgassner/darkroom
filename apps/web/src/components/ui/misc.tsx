import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'grid size-4 shrink-0 cursor-pointer place-items-center rounded border border-line bg-panel-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <CheckIcon className="size-3 text-white" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Round radio-style indicator (single choice lists such as speech models). */
export function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-line bg-panel-2',
        checked && 'border-accent',
      )}
    >
      {checked && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full min-w-0 rounded-lg border border-line bg-panel-2 px-[11px] py-[7px] text-sm text-text outline-none placeholder:text-muted focus-visible:border-accent',
        className,
      )}
      {...props}
    />
  );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-y rounded-lg border border-line bg-panel-2 px-[11px] py-[7px] text-sm text-text outline-none placeholder:text-muted focus-visible:border-accent',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/** Small pill: ZDR status, "clone", tool type, etc. */
export function Tag({ tone, className, ...props }: React.ComponentProps<'span'> & { tone?: 'ok' | 'warn' | 'accent' }) {
  return (
    <span
      className={cn(
        'rounded-full border border-line px-1.5 py-px text-[10px] whitespace-nowrap text-muted',
        tone === 'ok' && 'border-ok/40 text-ok',
        tone === 'warn' && 'border-warn/40 text-warn',
        tone === 'accent' && 'border-accent/45 text-accent-2',
        className,
      )}
      {...props}
    />
  );
}

/** Uppercase section label used throughout the side panels. */
export function SectionTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('section-title', className)} {...props} />;
}

/** Field label with stacked control (dialogs and tool forms). */
export function Field({
  label,
  className,
  children,
}: {
  label: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as a child
    <label className={cn('flex flex-col gap-1.5 text-xs text-muted', className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[70] max-w-80 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-text shadow-xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[26px] animate-spin rounded-full border-[3px] border-line border-t-accent',
        className,
      )}
    />
  );
}
