import { Button } from '@repo/ui/components/button';
import { DatabaseIcon, UnplugIcon } from 'lucide-react';

export function ExplorerHeader({ url, disconnect }: { url: string; disconnect: () => void }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-border/20 border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <DatabaseIcon aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h1 className="font-medium">SQLite explorer</h1>
          <p className="max-w-xl truncate text-muted-foreground text-xs">{url}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={disconnect}>
        <UnplugIcon aria-hidden="true" />
        Disconnect
      </Button>
    </header>
  );
}
