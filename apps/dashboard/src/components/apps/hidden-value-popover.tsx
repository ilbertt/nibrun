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
 * Why a value has no eye to toggle. The button looks like the one on every other row and answers
 * instead of doing nothing, because a control that is simply dead is one an owner tries again.
 */
export function HiddenValuePopover({
  name,
  title,
  description,
  onReplace,
}: {
  name: string;
  title: string;
  description: string;
  onReplace: () => void;
}) {
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
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        <Button type="button" variant="outline" size="sm" onClick={onReplace}>
          Replace the value
        </Button>
      </PopoverContent>
    </Popover>
  );
}
