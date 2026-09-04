import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { type AppSpec, AXES, AXIS_KEYS, fleetPrice, formatUsd, usedOn } from '#lib/calculator.ts';

const FULL_PERCENT = 100;

function RoomMeters({ apps }: { apps: AppSpec[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-muted-foreground text-xs">Max allowed</span>
      {AXIS_KEYS.map((axisKey) => {
        const axis = AXES[axisKey];
        const used = usedOn({ apps, axisKey });
        return (
          <div key={axisKey} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground text-xs">{axis.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {axis.format(used)} / {axis.format(axis.fleetLimit)}
              </span>
            </div>
            <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${(used / axis.fleetLimit) * FULL_PERCENT}%` }}
              />
            </span>
          </div>
        );
      })}
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
