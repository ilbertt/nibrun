import { cn } from '@repo/ui/lib/utils';
import type { ComponentProps } from 'react';

// `overflow-y-auto` clips both axes, so the box is bled outwards and padded back on both. Sideways
// it has to match `DialogContent`'s own padding, or a control flush against the edge loses its
// focus ring; downwards it only has to clear what a control draws below itself, such as the base
// under a key.
export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('-mx-6 -my-1 max-h-[70vh] overflow-y-auto px-6 py-1', className)}
      {...props}
    />
  );
}
