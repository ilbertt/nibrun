import { CellBar } from '@repo/ui/custom/cell-bar';
import { ArrowUpRightIcon, FileTerminalIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InstrumentPanel } from '#components/instrument-panel.tsx';

/**
 * What nibrun does, in one panel: a binary goes in, a URL comes out.
 *
 * Runs once on its own, because a visitor who has not scrolled yet has not agreed to press
 * anything — and then stays pressable, because the fastest way to believe deploying is one action
 * is to do it.
 */
const BINARY = { name: 'pocketbase', size: '14.2 MB' } as const;
const ADDRESS = 'pocketbase.nibrun.app';

/** What it is using once it is up: the figures an app actually gets, which is the whole claim. */
const RUNNING = '1 vCPU · 87 MiB / 256 MiB · 61 MiB / 1 GiB';

const STEPS = [
  { name: 'Uploading', ms: 1000 },
  { name: 'Unpacking', ms: 650 },
  { name: 'Booting', ms: 850 },
] as const;

const STEP_MS = STEPS.map((step) => step.ms);
const TOTAL_MS = sumOf(STEP_MS);

function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function BootDemo() {
  const { step, live, start } = useDeployRun();

  return (
    <InstrumentPanel name="Deploy" action={<Indicator live={live} />}>
      <Row label="Binary">
        <FileTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span>{BINARY.name}</span>
        <span className="ml-auto text-muted-foreground">{BINARY.size}</span>
      </Row>

      <div className="flex flex-col gap-1.5">
        <CellBar share={live ? 1 : progressOf(step)} tone="bg-primary text-primary" />
        <span className="text-muted-foreground text-xs">
          {live ? 'Answering on HTTPS, one machine of its own.' : `${STEPS[step]?.name ?? ''}…`}
        </span>
      </div>

      <Row label="URL">
        {live ? (
          <>
            <a
              href={`https://${ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
            >
              {ADDRESS}
              <ArrowUpRightIcon className="size-3 shrink-0" />
            </a>
            <button
              type="button"
              onClick={start}
              className="ml-auto shrink-0 text-muted-foreground text-xs hover:text-foreground"
            >
              Run again
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">waiting for it to boot…</span>
        )}
      </Row>

      {live && <p className="font-mono text-[11px] text-muted-foreground">{RUNNING}</p>}
    </InstrumentPanel>
  );
}

/** A labelled readout, set into the face like everything else you read rather than press. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="flex items-center gap-2 bg-input px-2.5 py-2 font-mono text-xs">
        {children}
      </span>
    </div>
  );
}

function Indicator({ live }: { live: boolean }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
      <span
        className={`size-1.5 rounded-full ${live ? 'bg-primary' : 'animate-pulse bg-warning'}`}
      />
      {live ? 'live' : 'working'}
    </span>
  );
}

/** How far through the whole run the current step has got, so one bar covers all of it. */
function progressOf(step: number): number {
  return sumOf(STEP_MS.slice(0, step)) / TOTAL_MS;
}

type DeployRun = { step: number; live: boolean; start: () => void };

/**
 * Walks the steps once and stops.
 *
 * One timer re-armed per step rather than an interval: the steps are not the same length, and an
 * interval would have to be the shortest of them with a counter on top.
 */
function useDeployRun(): DeployRun {
  const [step, setStep] = useState(0);
  const live = step >= STEPS.length;

  useEffect(() => {
    if (live) {
      return;
    }
    const timer = setTimeout(() => setStep((current) => current + 1), STEPS[step]?.ms);
    return () => clearTimeout(timer);
  }, [live, step]);

  return { step, live, start: () => setStep(0) };
}
