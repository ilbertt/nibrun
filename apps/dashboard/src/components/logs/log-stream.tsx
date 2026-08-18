import type { TenantLogRecord } from '@repo/protocol';
import { ScrollArea } from '@repo/ui/components/scroll-area';
import { LogLine } from '#components/logs/log-line.tsx';
import { usePinnedViewport } from '#lib/hooks/use-pinned-viewport.ts';

export function LogStream({ records }: { records: readonly TenantLogRecord[] }) {
  const containerRef = usePinnedViewport(records);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1 rounded-2xl border bg-muted/30">
        <div className="flex flex-col gap-0.5 p-3 font-mono text-xs">
          {records.map((record) => (
            <LogLine key={`${record.sourceId}/${record.sequence}`} record={record} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
