import { CRON_TIME_ZONE, type TenantLogRecord } from '@repo/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/lib/utils';
import { ClockIcon } from 'lucide-react';
import { ansiSpans } from '#lib/ansi.ts';
import { timeOfDay } from '#lib/format-timestamp.ts';

const TERMINATOR = /\r?\n$/;

export function LogLine({
  record,
  cronSchedule,
}: {
  record: TenantLogRecord;
  cronSchedule: string | undefined;
}) {
  const wroteToStderr = record.stream === 'stderr';

  return (
    <div className="flex gap-3">
      <span className="shrink-0 text-muted-foreground tabular-nums">{timeOfDay(record._time)}</span>
      <span
        className={cn('w-7 shrink-0', wroteToStderr ? 'text-destructive' : 'text-muted-foreground')}
      >
        {wroteToStderr ? 'err' : 'out'}
      </span>
      <span
        className={cn('min-w-0 whitespace-pre-wrap break-all', wroteToStderr && 'text-destructive')}
      >
        {ansiSpans(record._msg.replace(TERMINATOR, '')).map((span) => (
          <span key={span.offset} style={span.style}>
            {span.text}
          </span>
        ))}
        {record.droppedBytes !== undefined && (
          <span className="text-muted-foreground"> ({record.droppedBytes} bytes)</span>
        )}
        {record.cronJobId !== undefined && (
          <Tooltip>
            <TooltipTrigger
              aria-label="Cron job details"
              className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
            >
              <ClockIcon className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm flex-col items-start gap-1 font-mono">
              <span>
                {cronSchedule === undefined
                  ? 'Schedule unavailable'
                  : `${cronSchedule} (${CRON_TIME_ZONE})`}
              </span>
              <span className="break-all opacity-60">{record.cronJobId}</span>
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
