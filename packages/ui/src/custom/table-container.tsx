import { cn } from '@repo/ui/lib/utils';
import type { ComponentProps } from 'react';

/**
 * The panel a table stands in when the table is the whole of what is being shown.
 *
 * A `Card` was doing this and is the wrong thing for it: a card holds its content on a face, inset
 * from the edges and riveted down at the corners, and a table handed that face whole leaves nothing
 * to inset from and nothing to fasten — so every caller turned the padding off and the rivets came
 * to rest on the header row and the last line.
 *
 * A table that is one section of something larger is not this. It belongs in the card that has the
 * rest, where the panel around it is already drawn.
 */
export function TableContainer({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="table-container-panel"
      className={cn(
        'overflow-hidden rounded-[min(var(--radius-4xl),24px)] border-2 border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
