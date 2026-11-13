import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

/** Compact select in the app style. Pass either flat `options` or `groups`. Empty values are mapped to a sentinel. */
export function Select({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  // Radix Select does not allow empty-string values
  const EMPTY = '__empty__';
  const enc = (v: string) => (v === '' ? EMPTY : v);
  const dec = (v: string) => (v === EMPTY ? '' : v);
  const renderItem = (o: SelectOption) => (
    <SelectPrimitive.Item
      key={o.value}
      value={enc(o.value)}
      disabled={o.disabled}
      className="relative flex cursor-pointer items-center rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-panel-2"
    >
      <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2">
        <CheckIcon className="size-4 text-accent-2" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
  return (
    <SelectPrimitive.Root value={enc(value)} onValueChange={(v) => onValueChange(dec(v))}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-[11px] py-[7px] text-left text-sm outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 [&>span]:truncate',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDownIcon className="size-4 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-[min(420px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-line bg-panel text-text shadow-2xl"
        >
          <SelectPrimitive.Viewport className="p-1">
            {groups
              ? groups.map((g) => (
                  <SelectPrimitive.Group key={g.label}>
                    <SelectPrimitive.Label className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {g.label}
                    </SelectPrimitive.Label>
                    {g.options.map(renderItem)}
                  </SelectPrimitive.Group>
                ))
              : options.map(renderItem)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
