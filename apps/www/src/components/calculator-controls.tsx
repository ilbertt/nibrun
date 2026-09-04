import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/lib/utils';
import { PlusIcon, XIcon } from 'lucide-react';
import {
  type AppSpec,
  AXES,
  AXIS_KEYS,
  type AxisKey,
  appName,
  appPrice,
  formatUsd,
  pickableSteps,
  stepValue,
  usedOn,
} from '#lib/calculator.ts';

const FULL_PERCENT = 100;

function StepPicker({
  axisKey,
  step,
  tint,
  pickable,
  onPick,
}: {
  axisKey: AxisKey;
  step: number;
  tint: string;
  pickable: boolean[];
  onPick: (step: number) => void;
}) {
  const axis = AXES[axisKey];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs">{axis.name}</span>
        <span className="font-medium text-xs tabular-nums">
          {axis.format(stepValue({ axisKey, step }))}
        </span>
      </div>
      <div className="flex gap-1">
        {[...axis.steps.entries()].map(([index, value]) => (
          <button
            key={value}
            type="button"
            disabled={!pickable[index]}
            aria-label={`${axis.name} ${axis.format(value)}`}
            aria-pressed={index === step}
            onClick={() => onPick(index)}
            className={cn(
              'h-4 flex-1 rounded-sm border transition-colors disabled:opacity-40',
              index > step && 'border-border bg-transparent enabled:hover:bg-muted',
            )}
            style={index <= step ? { backgroundColor: tint, borderColor: tint } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function AppCard({
  app,
  index,
  apps,
  active,
  removable,
  onPick,
  onRemove,
  onHighlight,
}: {
  app: AppSpec;
  index: number;
  apps: AppSpec[];
  active: boolean;
  removable: boolean;
  onPick: (picked: { axisKey: AxisKey; step: number }) => void;
  onRemove: () => void;
  onHighlight: (highlighted: boolean) => void;
}) {
  const price = appPrice({ app, index });
  const name = appName(index);
  return (
    <li
      onMouseEnter={() => onHighlight(true)}
      onMouseLeave={() => onHighlight(false)}
      onFocusCapture={() => onHighlight(true)}
      onBlurCapture={() => onHighlight(false)}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 transition-colors',
        active ? 'bg-muted/50' : 'border-border/60',
      )}
      style={active ? { borderColor: app.tint } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: app.tint }} />
        <span className="truncate font-medium text-sm">{name}</span>
        <span className="ml-auto shrink-0 font-medium text-primary text-sm tabular-nums">
          {price === 0 ? 'free' : `${formatUsd(price)}/mo`}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!removable}
          onClick={onRemove}
          aria-label={`Delete ${name}`}
        >
          <XIcon />
        </Button>
      </div>
      {AXIS_KEYS.map((axisKey) => (
        <StepPicker
          key={axisKey}
          axisKey={axisKey}
          step={app.steps[axisKey]}
          tint={app.tint}
          pickable={pickableSteps({ apps, app, axisKey })}
          onPick={(step) => onPick({ axisKey, step })}
        />
      ))}
    </li>
  );
}

function RoomMeters({ apps }: { apps: AppSpec[] }) {
  return (
    <div className="flex flex-col gap-3 border-border/60 border-t pt-5">
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

export function CalculatorControls({
  apps,
  highlighted,
  onPick,
  onRemove,
  onHighlight,
  onAdd,
  canAdd,
}: {
  apps: AppSpec[];
  highlighted: number | null;
  onPick: (picked: { ordinal: number; axisKey: AxisKey; step: number }) => void;
  onRemove: (ordinal: number) => void;
  onHighlight: (ordinal: number | null) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  return (
    <>
      <ul className="flex flex-col gap-3">
        {[...apps.entries()].map(([index, app]) => (
          <AppCard
            key={app.ordinal}
            app={app}
            index={index}
            apps={apps}
            active={app.ordinal === highlighted}
            removable={apps.length > 1}
            onPick={(picked) => onPick({ ordinal: app.ordinal, ...picked })}
            onRemove={() => onRemove(app.ordinal)}
            onHighlight={(on) => onHighlight(on ? app.ordinal : null)}
          />
        ))}
      </ul>
      <Button variant="outline" className="w-full" disabled={!canAdd} onClick={onAdd}>
        <PlusIcon />
        Add an app
      </Button>
      <RoomMeters apps={apps} />
    </>
  );
}
