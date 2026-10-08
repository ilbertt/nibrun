import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { useSqliteApp } from '#lib/hooks/use-sqlite-app.ts';
import { useSqliteFilePath } from '#lib/hooks/use-sqlite-file-path.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

export function SqliteAppHeader() {
  const app = useSqliteApp();
  const filePath = useSqliteFilePath();
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="min-w-0 truncate font-medium" title={app?.name}>
          {app?.name ?? 'SQLite explorer'}
        </h1>
        {filePath !== undefined && (
          <span
            className="min-w-0 truncate font-mono text-muted-foreground text-sm"
            title={filePath}
          >
            {filePath}
          </span>
        )}
      </div>
      {app !== undefined && (
        <Button
          variant="outline"
          size="sm"
          render={<Link to={AppRoute.to} params={{ appId: app.id }} />}
        >
          <ArrowLeftIcon />
          Back to app
        </Button>
      )}
    </header>
  );
}
