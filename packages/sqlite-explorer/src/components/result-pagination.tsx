import type { QueryResult } from '@libredb/studio/types';
import { Button } from '@repo/ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

export function ResultPagination({
  pagination,
  running,
  loadPage,
}: {
  pagination: NonNullable<QueryResult['pagination']>;
  running: boolean;
  loadPage: (offset: number) => void;
}) {
  const offset = pagination.offset;
  const pageSize = pagination.limit;
  return (
    <nav
      aria-label="Result pages"
      className="flex shrink-0 items-center justify-between border-border/20 border-t px-4 py-2"
    >
      <span className="text-muted-foreground text-xs">
        Page {Math.floor(offset / pageSize) + 1} · {pageSize} rows per page
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={running || offset === 0}
          onClick={() => loadPage(Math.max(0, offset - pageSize))}
        >
          <ChevronLeftIcon aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={running || !pagination.hasMore}
          onClick={() => loadPage(offset + pageSize)}
        >
          Next
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
