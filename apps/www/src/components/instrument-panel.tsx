import type { ReactNode } from 'react';

const PERCENT_SCALE = 100;
const FULL = 1;

/** The same thresholds the dashboard's own meters use, so a preview does not invent its own. */
const NEARLY_FULL = 0.8;
const CRITICALLY_FULL = 0.9;

const TICK_COUNT = 21;
const MAJOR_TICK_EVERY = 5;
const TICKS = Array.from(Array(TICK_COUNT).keys());

/**
 * A panel whose name sits in a break in its own top border, over a dithered offset frame.
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
    <section className="dither-frame flex flex-col border-2 border-border bg-card">
      <header className="-mt-[13px] flex items-center justify-between gap-3 px-4">
        <h2 className="bg-card px-2 font-medium text-base">{name}</h2>
        {action && <span className="bg-card px-2">{action}</span>}
      </header>
      <div className="flex flex-col gap-4 p-5 pt-4 text-sm">{children}</div>
    </section>
  );
}

function fillColour(share: number): string {
  if (share >= CRITICALLY_FULL) {
    return 'bg-destructive';
  }
  return share >= NEARLY_FULL ? 'bg-warning' : 'bg-foreground';
}

/**
 * One reading against a ruler, which is what makes a limit legible as a limit.
 *
 * The bar is `aria-hidden`: the figures above it already say what it says, and a `meter` role on a
 * div only re-announces them less precisely.
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

  return (
    <div className="flex flex-col gap-1.5">
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
      <div aria-hidden="true" className="relative h-5 border-2 border-border bg-input">
        <span
          className={`absolute inset-y-0 left-0 ${fillColour(share)}`}
          style={{ width: `${percent}%` }}
        />
        {/* The handle, sitting where the reading stops. */}
        <span
          className="absolute top-[-3px] bottom-[-3px] w-3.5 -translate-x-1/2 border-2 border-border bg-card"
          style={{ left: `${percent}%` }}
        />
      </div>
      <Ruler />
    </div>
  );
}

/** Every fifth tick is taller, so a share can be read off the scale without a number under it. */
function Ruler() {
  return (
    <span aria-hidden="true" className="flex justify-between">
      {TICKS.map((tick) => (
        <span
          key={tick}
          className={`w-px bg-border ${
            tick % MAJOR_TICK_EVERY === 0 ? 'h-2 opacity-70' : 'h-1 opacity-40'
          }`}
        />
      ))}
    </span>
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
