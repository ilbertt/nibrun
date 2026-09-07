const FULL = 1;
const PERCENT_SCALE = 100;

/**
 * Cells rather than a bar, and twenty-four of them.
 *
 * Everything this product measures is a share of something fixed and small — 256 MiB, one vCPU,
 * one disk, one binary on its way up — so a reading that lands between two cells claims a
 * precision it does not have. Twenty-four divides into halves, thirds and quarters, which are the
 * fractions anyone actually reads off a meter.
 */
const CELL_COUNT = 24;
const CELLS = Array.from(Array(CELL_COUNT).keys());

/**
 * A row of cells lit up to a share, behind glass.
 *
 * Without a `label` it is decoration for figures printed beside it and hidden from a screen
 * reader; with one it is the reading itself and says so.
 */
export function CellBar({
  share,
  tone = 'bg-primary text-primary',
  label,
}: {
  share: number;
  /** Background and text colour together: a lit cell blooms in its own colour via `currentColor`. */
  tone?: string;
  label?: string;
}) {
  const lit = Math.round(Math.min(share, FULL) * CELL_COUNT);
  const meter =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': PERCENT_SCALE,
          'aria-valuenow': Math.round(Math.min(share, FULL) * PERCENT_SCALE),
        } as const);

  return (
    <span {...meter} className="display-glass flex h-4 gap-[3px] border-2 border-border p-[3px]">
      {CELLS.map((cell) => (
        <span
          key={cell}
          className={
            cell < lit
              ? `flex-1 shadow-[0_0_5px_-1px_currentColor] transition-colors ${tone}`
              : 'flex-1 bg-border/20 transition-colors'
          }
        />
      ))}
    </span>
  );
}
