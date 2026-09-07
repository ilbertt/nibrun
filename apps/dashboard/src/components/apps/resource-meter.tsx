import { CellBar } from '@repo/ui/custom/cell-bar';
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

/** No reading rather than none spent, which is what a nought here would be read as. */
const UNMEASURED = '—';

/** What the app is using of one resource, and when that was true. */
export type ResourceReading = {
  used: string;
  share: number;
  measuredAt: string;
};

function fillColour(share: number): string {
  if (share >= CRITICALLY_FULL) {
    return 'bg-destructive';
  }
  return share >= NEARLY_FULL ? 'bg-warning' : 'bg-primary';
}

/**
 * A share as a whole number, which is the most a ring three quarters of a line tall can claim: a
 * decimal here would read as a precision the reading does not have, being one sample of a minute.
 */
function percentOf(share: number): number {
  return Math.round(Math.min(share, FULL) * PERCENT_SCALE);
}

function readingLabel({
  label,
  reading,
}: {
  label: string;
  reading: ResourceReading | null;
}): string {
  return reading
    ? `${label} used, measured ${dayAndMinute(reading.measuredAt)}`
    : `${label} not measured yet`;
}

/**
 * One resource the app was given, with a ring of what it is using of it.
 *
 * The row shows what is being spent and the ring's label when that was measured, which is the part
 * a figure on its own gets wrong: an app that has stopped keeps the last reading taken while it
 * ran, so the number sitting there reads as now.
 *
 * The ring is drawn even where nothing has been measured, as an empty track. It is what keeps the
 * three rows in one column when only some of them have a reading, and the dash beside it is what
 * says the emptiness is missing rather than nought.
 */
export function ResourceMeter({
  icon: Icon,
  label,
  total,
  reading,
  showsPercent = false,
}: {
  icon: LucideIcon;
  label: string;
  /** What the app was allocated, which it has whether anything has measured it or not. */
  total: string;
  reading: ResourceReading | null;
  /** For a figure whose unit does not say what share it is — 0.36 of 2 vCPU says nothing. */
  showsPercent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4 shrink-0" />
          {label}
        </span>
        <span className="font-mono tabular-nums">
          {reading?.used ?? UNMEASURED}
          <span className="text-muted-foreground">
            {reading && showsPercent ? ` (${percentOf(reading.share)}%)` : ''} / {total}
          </span>
        </span>
      </div>
      <CellBar
        share={reading?.share ?? 0}
        tone={reading ? fillColour(reading.share) : 'bg-border/30'}
        label={readingLabel({ label, reading })}
      />
    </div>
  );
}
