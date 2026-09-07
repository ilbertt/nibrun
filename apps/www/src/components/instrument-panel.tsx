import { CellBar } from '@repo/ui/custom/cell-bar';
import type { ReactNode } from 'react';

const PERCENT_SCALE = 100;
const FULL = 1;

/** The same thresholds the dashboard's own meters use, so a preview does not invent its own. */
const NEARLY_FULL = 0.8;
const CRITICALLY_FULL = 0.9;

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
    <section className="panel-face relative flex flex-col border-2 border-border bg-card">
      {/* Centred on the border rather than pulled up by a fixed amount, so a name and a badge of
          different heights both sit on the line. */}
      {/* Above the body, not merely positioned over it: a readout with `backdrop-filter` becomes a
          stacking context of its own and paints as though positioned, so anything the header opens
          would otherwise go behind whatever comes after it in the panel. */}
      <header className="absolute inset-x-0 top-px z-20 flex -translate-y-1/2 items-center justify-between gap-3 px-5">
        <h2 className="bg-card px-2 font-heading text-base">{name}</h2>
        {action && <span className="flex items-center bg-card px-2">{action}</span>}
      </header>
      <div className="flex flex-col gap-4 p-6 text-sm">{children}</div>
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
      <CellBar share={share} tone={litColour(share)} />
    </div>
  );
}

/** A label and its value on one line, the shape most of this dashboard is made of. */
export function Reading({
  label,
  hint,
  children,
}: {
  label: string;
  /** What the dotted underline promises to say, if the label carries one. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      {hint === undefined ? (
        <span className="text-muted-foreground">{label}</span>
      ) : (
        <Tooltip label={label} says={hint} />
      )}
      <span className="min-w-0 font-mono text-xs tabular-nums">{children}</span>
    </div>
  );
}

/**
 * A word that answers when you point at it.
 *
 * Hover and focus in CSS rather than state in React: it has nothing to decide, and a tooltip that
 * only appears for a mouse is one a keyboard never reaches.
 */
export function Tooltip({ label, says }: { label: string; says: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="hint-underline cursor-help text-muted-foreground outline-none"
        aria-label={`${label}: ${says}`}
      >
        {label}
      </button>
      <span
        aria-hidden="true"
        className="floats-above pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-max max-w-56 border-2 border-border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {says}
      </span>
    </span>
  );
}
