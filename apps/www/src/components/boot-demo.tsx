import { Button } from '@repo/ui/components/button';
import { CellBar } from '@repo/ui/custom/cell-bar';
import { ArrowUpRightIcon, FileTerminalIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InstrumentPanel } from '#components/instrument-panel.tsx';

/**
 * What nibrun does, in one panel: a binary goes in, a URL comes out — and then the part no other
 * dashboard has to show, which is the app going to sleep and coming back.
 *
 * The bar means whatever the app is doing at the time: how far the upload has got, then how much
 * memory is in use, then nothing at all. Draining it is what makes sleeping legible as a state
 * rather than a word, and filling it in one beat is the whole argument for the wake being fast.
 */
const BINARY = { name: 'pocketbase', size: '14.2 MB' } as const;
const ADDRESS = 'pocketbase.nibrun.app';

const MEMORY_SHARE = 0.34;
const MEMORY_USED = '87 MiB';
const MEMORY_TOTAL = '256 MiB';

/** The real figure: a snapshot restore, measured with the ARP refresh that makes it reachable. */
const WAKE_MS = 112;

/** Long enough to read that it is running, short enough that nobody waits five real minutes. */
const IDLE_MS = 3800;

const STEPS = [
  { name: 'Uploading', ms: 900 },
  { name: 'Unpacking', ms: 600 },
  { name: 'Booting', ms: 800 },
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

type Phase = 'deploying' | 'live' | 'sleeping' | 'waking';

export function BootDemo() {
  const run = useAppLifecycle();

  return (
    <InstrumentPanel name="Deploy" action={<Indicator phase={run.phase} />}>
      <Row label="Binary">
        <FileTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span>{BINARY.name}</span>
        <span className="ml-auto text-muted-foreground">{BINARY.size}</span>
      </Row>

      <div className="flex flex-col gap-1.5">
        <CellBar share={barShare(run)} tone={barTone(run.phase)} />
        <span className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{caption(run)}</span>
          {run.wokeIn !== undefined && (
            <span className="font-mono text-primary tabular-nums">woke in {WAKE_MS} ms</span>
          )}
        </span>
      </div>

      <Row label="URL">
        {run.phase === 'deploying' ? (
          <span className="text-muted-foreground">waiting for it to boot…</span>
        ) : (
          <a
            href={`https://${ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex min-w-0 items-center gap-1 truncate hover:underline ${
              run.phase === 'sleeping' ? 'text-muted-foreground' : 'text-primary'
            }`}
          >
            {ADDRESS}
            <ArrowUpRightIcon className="size-3 shrink-0" />
          </a>
        )}
      </Row>

      {run.phase === 'sleeping' && (
        <Button onClick={run.wake} className="w-full">
          Send it a request
        </Button>
      )}
    </InstrumentPanel>
  );
}

function barShare(run: AppLifecycle): number {
  if (run.phase === 'deploying') {
    return sumOf(STEP_MS.slice(0, run.step)) / TOTAL_MS;
  }
  return run.phase === 'sleeping' ? 0 : MEMORY_SHARE;
}

function barTone(phase: Phase): string {
  return phase === 'sleeping' ? 'bg-border/30' : 'bg-primary';
}

function caption(run: AppLifecycle): string {
  if (run.phase === 'deploying') {
    return `${STEPS[run.step]?.name ?? ''}…`;
  }
  if (run.phase === 'sleeping') {
    return 'Asleep. Nothing running, nothing billed.';
  }
  return `Using ${MEMORY_USED} of ${MEMORY_TOTAL}`;
}

function Indicator({ phase }: { phase: Phase }) {
  const lamp = phase === 'live' || phase === 'waking' ? 'bg-primary' : 'animate-pulse bg-warning';

  return (
    <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
      <span className={`size-1.5 rounded-full ${phase === 'sleeping' ? 'bg-border' : lamp}`} />
      {phase === 'deploying' ? 'working' : phase}
    </span>
  );
}

/** A labelled readout, which is what everything here is other than the one thing you press. */
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

type AppLifecycle = {
  phase: Phase;
  step: number;
  wokeIn: number | undefined;
  wake: () => void;
};

/**
 * Deploys once, runs, falls asleep, and waits to be woken.
 *
 * One timer re-armed per phase rather than an interval: the phases are not the same length — the
 * wake is a tenth of a second and the idle is thousands — and an interval would have to be the
 * shortest of them with a counter on top.
 */
function useAppLifecycle(): AppLifecycle {
  const [phase, setPhase] = useState<Phase>('deploying');
  const [step, setStep] = useState(0);
  const [wokeIn, setWokeIn] = useState<number>();

  useEffect(() => {
    if (phase === 'deploying') {
      const last = step === STEPS.length - 1;
      const timer = setTimeout(
        () => (last ? setPhase('live') : setStep((current) => current + 1)),
        STEP_MS[step],
      );
      return () => clearTimeout(timer);
    }
    if (phase === 'live') {
      // The wake time belongs to the run that woke it, so it goes when the app does.
      const timer = setTimeout(() => {
        setWokeIn(undefined);
        setPhase('sleeping');
      }, IDLE_MS);
      return () => clearTimeout(timer);
    }
    if (phase === 'waking') {
      const timer = setTimeout(() => setPhase('live'), WAKE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, step]);

  function wake(): void {
    setWokeIn(WAKE_MS);
    setPhase('waking');
  }

  return { phase, step, wokeIn, wake };
}
