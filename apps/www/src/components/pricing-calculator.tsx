import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { useEffect, useState } from 'react';
import { CalculatorControls } from '#components/calculator-controls.tsx';
import { CalculatorScene } from '#components/calculator-scene.tsx';
import {
  type AppSpec,
  type AxisKey,
  createApp,
  fitsAnotherApp,
  fleetPrice,
  formatUsd,
  initialApps,
  MAX_APPS,
  nextOrdinalAfter,
  readStoredApps,
  withStep,
  writeStoredApps,
} from '#lib/calculator.ts';

export function PricingCalculator() {
  const [apps, setApps] = useState<AppSpec[]>(initialApps);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  // The page is prerendered, so what the reader last built cannot be the first render — it is
  // read once the client is running, and only then does saving start.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const stored = readStoredApps();
    if (stored !== null) {
      setApps(stored);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) {
      writeStoredApps(apps);
    }
  }, [apps, restored]);

  function pick({ ordinal, axisKey, step }: { ordinal: number; axisKey: AxisKey; step: number }) {
    setApps((current) =>
      current.map((app) => (app.ordinal === ordinal ? withStep({ app, axisKey, step }) : app)),
    );
  }

  function remove(ordinal: number) {
    setApps((current) => current.filter((app) => app.ordinal !== ordinal));
    setHighlighted(null);
  }

  function add() {
    setApps((current) =>
      current.length < MAX_APPS
        ? [...current, createApp({ ordinal: nextOrdinalAfter(current) })]
        : current,
    );
  }

  const total = fleetPrice(apps);

  return (
    <div className="grid w-full gap-10 lg:grid-cols-[1fr_19rem] lg:gap-14">
      <div className="min-w-0 self-start lg:sticky lg:top-8">
        <CalculatorScene apps={apps} highlighted={highlighted} />
      </div>
      <div className="flex flex-col gap-4">
        <CalculatorControls
          apps={apps}
          highlighted={highlighted}
          onPick={pick}
          onRemove={remove}
          onHighlight={setHighlighted}
          onAdd={add}
          canAdd={apps.length < MAX_APPS && fitsAnotherApp(apps)}
        />
        <div className="flex flex-col gap-2 border-border/60 border-t pt-5">
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
            The first {FREE_APPS_COUNT} apps have their ${PRICE_PER_APP_USD} base on us. What you
            grew them into, sadly, is not on us.
          </p>
        </div>
      </div>
    </div>
  );
}
