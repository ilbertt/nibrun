import { TerminalIcon } from 'lucide-react';

export function BrandMark() {
  return (
    <div className="flex items-center gap-2 self-center font-medium">
      <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <TerminalIcon className="size-4" />
      </div>
      nibrun
    </div>
  );
}
