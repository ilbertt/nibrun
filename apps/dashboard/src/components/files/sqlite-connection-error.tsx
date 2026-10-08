import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@repo/ui/components/popover';
import { CircleAlertIcon } from 'lucide-react';

export function SqliteConnectionError({ name, error }: { name: string; error: Error }) {
  return (
    <Popover>
      <PopoverTrigger
        className="flex size-4 shrink-0 cursor-pointer items-center text-destructive"
        aria-label={`SQLite connection error for ${name}`}
      >
        <CircleAlertIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2">
        <PopoverTitle className="text-sm">Could not open database</PopoverTitle>
        <PopoverDescription className="whitespace-normal break-words text-xs">
          {error.message}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
