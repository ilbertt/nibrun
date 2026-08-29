import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import type { LucideIcon } from 'lucide-react';
import { dayAndMinute } from '#lib/format-timestamp.ts';

const PERCENT_SCALE = 100;
const FULL = 1;

/**
 * Where the ring stops reading as healthy, and where it stops reading as survivable.
 *
 * Eighty and ninety rather than the sixty a first guess reaches for: sixty is where a half-full
 * volume starts looking like a problem, and a warning that fires on an app doing nothing wrong is
 * one an owner learns to ignore. These are what disk and memory alerting has settled on almost
 * everywhere — Nagios, Zabbix and the rest ship 80 and 90 as defaults — and they hold for cpu for
 * the same reason: sustained load below eighty percent is headroom, not a warning.
 */
const NEARLY_FULL = 0.8;
const CRITICALLY_FULL = 0.9;

const RING_PIXELS = 28;
const RING_STROKE = 3;
const RING_RADIUS = (RING_PIXELS - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * What a share too small to draw is drawn as anyway.
 *
 * A tenant using half a percent of an 8 GiB volume rounds to a ring with nothing on it, which
 * reads as the one thing that is not true — that nothing has been written. The figure beside it
 * is exact and `aria-valuenow` carries the real share; this is only so that a little and none do
 * not look the same.
 */
const SMALLEST_VISIBLE_ARC = 2;

/** No reading rather than none spent, which is what a nought here would be read as. */
const UNMEASURED = '—';

const NOTHING_MEASURED =
  'Nothing has measured this yet — a reading is only taken while the app is running.';

/** What the app is using of one resource, and when that was true. */
export type ResourceReading = {
  used: string;
  share: number;
  measuredAt: string;
};

function arcColour(share: number): string {
  if (share >= CRITICALLY_FULL) {
    return 'text-destructive';
  }
  return share >= NEARLY_FULL ? 'text-warning' : 'text-primary';
}

function arcLength(share: number): number {
  const drawn = Math.min(share, FULL) * RING_LENGTH;
  return share > 0 ? Math.max(drawn, SMALLEST_VISIBLE_ARC) : 0;
}

/**
 * One resource the app was given, with a ring of what it is using of it.
 *
 * The figure carries no explanation beside it: none of the three counts quite what its name
 * suggests, and a sentence saying so under every row is three sentences nobody reads. They are on
 * hover instead, with the moment the reading was taken — which is the other thing that cannot be
 * left off, because an app that has stopped keeps the last reading taken while it ran and a bare
 * number reads as now.
 *
 * The ring is drawn even where nothing has been measured, as an empty track. It is what keeps the
 * three rows in one column when only some of them have a reading, and the dash beside it is what
 * says the emptiness is missing rather than nought.
 */
export function ResourceMeter({
  icon: Icon,
  label,
  total,
  note,
  reading,
}: {
  icon: LucideIcon;
  label: string;
  /** What the app was allocated, which it has whether anything has measured it or not. */
  total: string;
  /** What this particular figure counts, for whoever wonders why it is not what they expected. */
  note: string;
  reading: ResourceReading | null;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        {label}
      </span>
      <Tooltip>
        <TooltipTrigger className="flex cursor-help items-center gap-3">
          <span className="font-mono tabular-nums">
            {reading?.used ?? UNMEASURED}
            <span className="text-muted-foreground"> / {total}</span>
          </span>
          <svg
            className={`shrink-0 -rotate-90 ${reading ? arcColour(reading.share) : ''}`}
            width={RING_PIXELS}
            height={RING_PIXELS}
            viewBox={`0 0 ${RING_PIXELS} ${RING_PIXELS}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={PERCENT_SCALE}
            aria-valuenow={
              reading ? Math.round(Math.min(reading.share, FULL) * PERCENT_SCALE) : undefined
            }
            aria-label={`${label} used`}
          >
            <circle
              className="text-muted"
              cx={RING_PIXELS / 2}
              cy={RING_PIXELS / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE}
            />
            {reading ? (
              <circle
                cx={RING_PIXELS / 2}
                cy={RING_PIXELS / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={`${arcLength(reading.share)} ${RING_LENGTH}`}
              />
            ) : null}
          </svg>
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-1">
          <span>{reading ? note : NOTHING_MEASURED}</span>
          {reading ? (
            <span className="text-background/70">
              Last measured {dayAndMinute(reading.measuredAt)}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
