import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-line bg-panel-2 text-text hover:border-accent',
        primary: 'border-accent bg-accent font-semibold text-white hover:bg-accent-2',
        danger: 'border-line bg-panel-2 text-err hover:border-err',
        ghost: 'border-transparent bg-transparent text-text hover:bg-panel-2',
        link: 'h-auto border-none bg-transparent p-0 text-xs text-accent-2 hover:underline',
      },
      size: {
        default: 'px-[11px] py-[7px]',
        sm: 'px-2.5 py-1 text-xs',
        icon: 'size-8 rounded-full p-0',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'p-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), variant === 'link' && 'p-0', className)}
      {...props}
    />
  );
}

export { Button };
