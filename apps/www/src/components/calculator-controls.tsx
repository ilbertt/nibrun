import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/lib/utils';
import { PlusIcon, XIcon } from 'lucide-react';
import {
  type AppSpec,
  AXES,
  AXIS_KEYS,
  type AxisKey,
  appPrice,
  formatUsd,
  stepValue,
} from '#lib/calculator.ts';

function StepPicker({
  axisKey,
  step,
  onPick,
}: {
  axisKey: AxisKey;
  step: number;
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
            aria-label={`${axis.name} ${axis.format(value)}`}
            aria-pressed={index === step}
            onClick={() => onPick(index)}
            className={cn(
              'h-4 flex-1 rounded-sm border transition-colors',
              index <= step
                ? 'border-primary bg-primary'
                : 'border-border bg-transparent hover:bg-muted',
            )}
          />
        ))}
      </div>
    </div>
  );
}

function AppCard({
  app,
  index,
  active,
  removable,
  onPick,
  onRemove,
  onHighlight,
}: {
  app: AppSpec;
  index: number;
  active: boolean;
  removable: boolean;
  onPick: (picked: { axisKey: AxisKey; step: number }) => void;
  onRemove: () => void;
  onHighlight: (highlighted: boolean) => void;
}) {
  const price = appPrice({ app, index });
  return (
    <li
      onMouseEnter={() => onHighlight(true)}
      onMouseLeave={() => onHighlight(false)}
      onFocusCapture={() => onHighlight(true)}
      onBlurCapture={() => onHighlight(false)}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-border/60',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-[3px] bg-primary" />
        <span className="truncate font-medium text-sm">{app.name}</span>
        <span className="ml-auto shrink-0 font-medium text-primary text-sm tabular-nums">
          {price === 0 ? 'free' : `${formatUsd(price)}/mo`}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!removable}
          onClick={onRemove}
          aria-label={`Delete ${app.name}`}
        >
          <XIcon />
        </Button>
      </div>
      {AXIS_KEYS.map((axisKey) => (
        <StepPicker
          key={axisKey}
          axisKey={axisKey}
          step={app.steps[axisKey]}
          onPick={(step) => onPick({ axisKey, step })}
        />
      ))}
    </li>
  );
}

export function CalculatorControls({
  apps,
  highlightedId,
  onPick,
  onRemove,
  onHighlight,
  onAdd,
  canAdd,
}: {
  apps: AppSpec[];
  highlightedId: string | null;
  onPick: (picked: { id: string; axisKey: AxisKey; step: number }) => void;
  onRemove: (id: string) => void;
  onHighlight: (id: string | null) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  return (
    <>
      <ul className="flex flex-col gap-3">
        {[...apps.entries()].map(([index, app]) => (
          <AppCard
            key={app.id}
            app={app}
            index={index}
            active={app.id === highlightedId}
            removable={apps.length > 1}
            onPick={(picked) => onPick({ id: app.id, ...picked })}
            onRemove={() => onRemove(app.id)}
            onHighlight={(highlighted) => onHighlight(highlighted ? app.id : null)}
          />
        ))}
      </ul>
      <Button variant="outline" className="w-full" disabled={!canAdd} onClick={onAdd}>
        <PlusIcon />
        Add an app
      </Button>
    </>
  );
}
