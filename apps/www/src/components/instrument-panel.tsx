import type { ReactNode } from 'react';

const PERCENT_SCALE = 100;
const FULL = 1;

/** The same thresholds the dashboard's own meters use, so a preview does not invent its own. */
const NEARLY_FULL = 0.8;
const CRITICALLY_FULL = 0.9;

/**
 * Cells rather than a bar, and twenty-four of them.
 *
 * A share this product cares about is a share of something fixed and small — 256 MiB, one vCPU,
 * one disk — so a reading that lands between two cells is a reading claiming a precision a
 * once-a-minute sample does not have. Twenty-four divides into halves, thirds and quarters, which
 * are the fractions an owner actually reads off it.
 */
const CELL_COUNT = 24;
const CELLS = Array.from(Array(CELL_COUNT).keys());

/**
 * A panel whose name sits in a break in its own top border, bolted down at the corners.
 *
 * The legend is drawn rather than reserved: a `fieldset` would carry one for free, but only around
 * form controls, and most of what this frames is read rather than filled in.
 */
export function InstrumentPanel({
  name,
  action,
  children,
}: {
  name: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel-face flex flex-col border-2 border-border bg-card">
      <header className="-mt-[13px] flex items-center justify-between gap-3 px-5">
        <h2 className="legend-notch px-2 font-heading text-base">{name}</h2>
        {action && <span className="legend-notch px-2">{action}</span>}
      </header>
      <div className="flex flex-col gap-4 p-6 pt-4 text-sm">{children}</div>
    </section>
  );
}

/** Both, because a lit cell blooms in its own colour and `currentColor` is what carries it. */
function litColour(share: number): string {
  if (share >= CRITICALLY_FULL) {
    return 'bg-destructive text-destructive';
  }
  return share >= NEARLY_FULL ? 'bg-warning text-warning' : 'bg-primary text-primary';
}

/**
 * One resource, read off a row of cells that are lit or not.
 *
 * The strip is `aria-hidden`: the figures above it already say what it says, and a `meter` role on
 * a div only re-announces them less precisely.
 */
export function Gauge({
  label,
  used,
  total,
  share,
}: {
  label: string;
  used: string;
  total: string;
  share: number;
}) {
  const percent = Math.round(Math.min(share, FULL) * PERCENT_SCALE);
  const lit = Math.round(Math.min(share, FULL) * CELL_COUNT);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="hint-underline text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums">
          {used}
          <span className="text-muted-foreground">
            {' '}
            / {total} ({percent}%)
          </span>
        </span>
      </div>
      <span
        aria-hidden="true"
        className="display-glass flex h-4 gap-[3px] border-2 border-border p-[3px]"
      >
        {CELLS.map((cell) => (
          <span
            key={cell}
            className={
              cell < lit
                ? `flex-1 shadow-[0_0_5px_-1px_currentColor] ${litColour(share)}`
                : 'flex-1 bg-border/20'
            }
          />
        ))}
      </span>
    </div>
  );
}

/** A label and its value on one line, the shape most of this dashboard is made of. */
export function Reading({
  label,
  hint = false,
  children,
}: {
  label: string;
  hint?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={`text-muted-foreground ${hint ? 'hint-underline' : ''}`}>{label}</span>
      <span className="min-w-0 font-mono text-xs tabular-nums">{children}</span>
    </div>
  );
}
