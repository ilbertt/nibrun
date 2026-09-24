import { useEffect, useState } from 'react';
import { CalculatorControls } from '#components/calculator-controls.tsx';
import { CalculatorScene } from '#components/calculator-scene.tsx';
import { CalculatorSummary } from '#components/calculator-summary.tsx';
import {
  type AppSpec,
  type AxisKey,
  createApp,
  fitsAnotherApp,
  initialApps,
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
      fitsAnotherApp(current)
        ? [...current, createApp({ ordinal: nextOrdinalAfter(current) })]
        : current,
    );
  }

  return (
    <div className="grid w-full gap-10 pb-16 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_19rem] lg:gap-12 lg:pb-8">
      <div className="flex min-w-0 flex-col gap-6 lg:min-h-0">
        <div className="lg:min-h-0 lg:flex-1">
          <CalculatorScene apps={apps} highlighted={highlighted} />
        </div>
        <CalculatorSummary apps={apps} />
      </div>
      <div className="flex flex-col gap-4 lg:min-h-0">
        <CalculatorControls
          apps={apps}
          highlighted={highlighted}
          onPick={pick}
          onRemove={remove}
          onHighlight={setHighlighted}
          onAdd={add}
          canAdd={fitsAnotherApp(apps)}
        />
      </div>
    </div>
  );
}
