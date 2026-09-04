import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { useRef, useState } from 'react';
import { CalculatorControls } from '#components/calculator-controls.tsx';
import { CalculatorScene } from '#components/calculator-scene.tsx';
import {
  type AppSpec,
  type AxisKey,
  createApp,
  fleetPrice,
  formatUsd,
  INITIAL_APP_COUNT,
  initialApps,
  MAX_APPS,
} from '#lib/calculator.ts';

export function PricingCalculator() {
  const [apps, setApps] = useState<AppSpec[]>(initialApps);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const nextOrdinal = useRef(INITIAL_APP_COUNT);

  function pick({ id, axisKey, step }: { id: string; axisKey: AxisKey; step: number }) {
    setApps((current) =>
      current.map((app) =>
        app.id === id ? { ...app, steps: { ...app.steps, [axisKey]: step } } : app,
      ),
    );
  }

  function remove(id: string) {
    setApps((current) => current.filter((app) => app.id !== id));
    setHighlightedId(null);
  }

  // The ordinal is read outside the updater — React may defer it, and two adds in one tick
  // would then both see the same one and mint the same id. The cap has to be inside it, for
  // the same reason: `apps.length` out here is a render old.
  function add() {
    const ordinal = nextOrdinal.current;
    nextOrdinal.current += 1;
    setApps((current) =>
      current.length < MAX_APPS ? [...current, createApp({ ordinal })] : current,
    );
  }

  const total = fleetPrice(apps);

  return (
    <div className="grid w-full gap-10 lg:grid-cols-[1fr_19rem] lg:gap-14">
      <div className="min-w-0 self-start lg:sticky lg:top-8">
        <CalculatorScene apps={apps} highlightedId={highlightedId} />
      </div>
      <div className="flex flex-col gap-4">
        <CalculatorControls
          apps={apps}
          highlightedId={highlightedId}
          onPick={pick}
          onRemove={remove}
          onHighlight={setHighlightedId}
          onAdd={add}
          canAdd={apps.length < MAX_APPS}
        />
        <div className="flex flex-col gap-2 border-border/60 border-t pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">
              {apps.length} box{apps.length === 1 ? '' : 'es'}
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
            The first {FREE_APPS_COUNT} boxes have their ${PRICE_PER_APP_USD} base on us. What you
            grew them into, sadly, is not on us.
          </p>
        </div>
      </div>
    </div>
  );
}
