const FULL = 1;
const PERCENT_SCALE = 100;

/**
 * Cells rather than a bar, and twelve of them.
 *
 * Everything this product measures is a share of something fixed and small — 256 MiB, one vCPU,
 * one disk, one binary on its way up — so a reading that lands between two cells claims a
 * precision it does not have. Twelve still divides into halves, thirds and quarters, which are the
 * fractions anyone reads off a meter, and at twice the width each they are counted at a glance
 * rather than scanned.
 */
const CELL_COUNT = 12;
const CELLS = Array.from(Array(CELL_COUNT).keys());

/**
 * A row of cells lit up to a share, behind glass.
 *
 * Without a `label` it is decoration for figures printed beside it and hidden from a screen
 * reader; with one it is the reading itself and says so.
 */
/**
 * A share too small to fill a cell still lights one.
 *
 * An app using half a percent of a gigabyte rounds to nothing, and an empty bar reads as the one
 * thing that is not true — that nothing has been written. The figure beside it is exact and
 * `aria-valuenow` carries the real share; this is only so that a little and none do not look the
 * same.
 */
function litCells(share: number): number {
  const filled = Math.round(Math.min(share, FULL) * CELL_COUNT);
  return share > 0 ? Math.max(filled, 1) : 0;
}

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
  const lit = litCells(share);
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
    // Rounded and small rather than a flat row of blocks: most of what this measures sits near
    // empty — a quarter of a vCPU, a few percent of a disk — and one lit square in a hard row of
    // twelve reads as something broken rather than as a small reading.
    //
    // No frame and no bloom around it either: the cells are the reading, and a box drawn around
    // every figure on a page of figures is what makes a panel look like equipment.
    <span {...meter} className="flex h-1.5 gap-1">
      {CELLS.map((cell) => (
        <span
          key={cell}
          className={`flex-1 rounded-full transition-colors ${cell < lit ? tone : 'bg-border/30'}`}
        />
      ))}
    </span>
  );
}
