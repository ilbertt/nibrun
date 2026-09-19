import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { CellBar } from '@repo/ui/custom/cell-bar';
import { type AppSpec, AXES, AXIS_KEYS, fleetPrice, formatUsd, usedOn } from '#lib/calculator.ts';

// Three across rather than three stacked: under the chart a full-width bar is a long thin line
// with nothing to say, and the column has the room to put them beside each other.
function RoomMeters({ apps }: { apps: AppSpec[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs">Max allowed</span>
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-6">
        {AXIS_KEYS.map((axisKey) => {
          const axis = AXES[axisKey];
          const used = usedOn({ apps, axisKey });
          return (
            <div key={axisKey} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{axis.name}</span>
                <span className="font-mono tabular-nums">
                  {axis.format(used)}
                  <span className="text-muted-foreground"> / {axis.format(axis.fleetLimit)}</span>
                </span>
              </div>
              {/* No label: the figures beside it are the reading, so the cells are decoration. */}
              <CellBar share={used / axis.fleetLimit} rounded />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalculatorSummary({ apps }: { apps: AppSpec[] }) {
  const total = fleetPrice(apps);
  return (
    <div className="flex shrink-0 flex-col gap-5 border-border/60 border-t pt-5">
      <RoomMeters apps={apps} />
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {apps.length} app{apps.length === 1 ? '' : 's'}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-semibold text-3xl text-primary tabular-nums tracking-tight">
              {total === 0 ? 'Free' : formatUsd(total)}
            </span>
            <span className="text-muted-foreground text-sm">
              {total === 0 ? 'forever' : '/month'}
            </span>
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          The first {FREE_APPS_COUNT} apps have their ${PRICE_PER_APP_USD} base on us. What you grew
          them into, sadly, is not on us.
        </p>
      </div>
    </div>
  );
}
