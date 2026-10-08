import { LoaderCircleIcon } from 'lucide-react';

export function LoadingEditor() {
  return (
    <div
      role="status"
      className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm"
    >
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Loading editor…
    </div>
  );
}
