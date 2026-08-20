import { Button } from '@repo/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@repo/ui/components/popover';
import { EyeOffIcon } from 'lucide-react';

/**
 * Why a stored value has no eye to toggle. The button looks like the one on every other row and
 * answers instead of doing nothing, because a control that is simply dead is one an owner tries
 * again.
 */
export function SealedValuePopover({ name, onReplace }: { name: string; onReplace: () => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Why ${name} cannot be shown`}
          />
        }
      >
        <EyeOffIcon />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>Sealed</PopoverTitle>
          <PopoverDescription>
            This value was encrypted when it was set, and nothing here can read it back — not this
            page, and not nibrun. Replacing it is the only way to change what the app runs with.
          </PopoverDescription>
        </PopoverHeader>
        <Button type="button" variant="outline" size="sm" onClick={onReplace}>
          Replace the value
        </Button>
      </PopoverContent>
    </Popover>
  );
}
