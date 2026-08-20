import { cn } from '@repo/ui/lib/utils';
import type { ComponentProps } from 'react';

// The bleed has to match `DialogContent`'s own padding: `overflow-y-auto` makes the other axis
// scroll too, which would clip the focus ring of anything sitting flush against the edge.
export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('-mx-6 max-h-[70vh] overflow-y-auto px-6', className)}
      {...props}
    />
  );
}
