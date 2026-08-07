import type { TenantLogRecord } from '@repo/protocol';
import { timeOfDay } from '#lib/format-timestamp.ts';
import { cn } from '#lib/utils.ts';

const TERMINATOR = /\r?\n$/;

export function LogLine({ record }: { record: TenantLogRecord }) {
  const wroteToStderr = record.stream === 'stderr';

  return (
    <div className="flex gap-3">
      <span className="shrink-0 text-muted-foreground tabular-nums">{timeOfDay(record._time)}</span>
      <span
        className={cn('w-7 shrink-0', wroteToStderr ? 'text-destructive' : 'text-muted-foreground')}
      >
        {wroteToStderr ? 'err' : 'out'}
      </span>
      <span className={cn('whitespace-pre-wrap break-all', wroteToStderr && 'text-destructive')}>
        {record._msg.replace(TERMINATOR, '')}
        {record.droppedBytes !== undefined && (
          <span className="text-muted-foreground"> ({record.droppedBytes} bytes)</span>
        )}
      </span>
    </div>
  );
}
