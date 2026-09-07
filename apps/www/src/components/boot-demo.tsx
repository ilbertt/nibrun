import { Button } from '@repo/ui/components/button';
import { useEffect, useState } from 'react';
import { Gauge, InstrumentPanel, Reading } from '#components/instrument-panel.tsx';

/**
 * A deploy you run yourself, beside the panel it produces.
 *
 * Pressed rather than played on a loop: the whole claim is that deploying here is one action, and
 * a visitor who has done it once on the landing page already knows the product.
 *
 * The figures are the ones an app actually gets — 1 vCPU, 256 MiB, a gigabyte of disk — because
 * the point is that the whole thing is this small.
 */
const STEPS = [
  { name: 'Uploading', detail: 'pocketbase · 14.2 MB', ms: 1100 },
  { name: 'Unpacking', detail: 'into a machine of its own', ms: 700 },
  { name: 'Booting', detail: 'Firecracker microVM · 112 ms', ms: 900 },
  { name: 'Active', detail: 'pocketbase.nibrun.app', ms: 0 },
] as const;

const LAST_STEP = STEPS.length - 1;
const FIRST_STEP = STEPS[0];

/** Total, so a step read by a number the state happens to hold is still a step. */
function stepAt(index: number): (typeof STEPS)[number] {
  return STEPS[index] ?? FIRST_STEP;
}

/** What the app is using once it is up. */
const RUNNING = { cpu: 0.09, memory: 0.34, volume: 0.06 } as const;

export function BootDemo() {
  const { step, running, live, start } = useDeployRun();

  return (
    <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
      <InstrumentPanel name="Deploy" action={<Indicator running={running} live={live} />}>
        <ol className="flex flex-col gap-3">
          {[...STEPS.entries()].map(([index, entry]) => (
            <li key={entry.name} className="flex items-start gap-3">
              <Lamp state={lampState({ index, step, running, live })} />
              <span className="flex min-w-0 flex-col">
                <span
                  className={reached({ index, step, running, live }) ? '' : 'text-muted-foreground'}
                >
                  {entry.name}
                </span>
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {reached({ index, step, running, live }) ? entry.detail : '—'}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <Button onClick={start} disabled={running} className="w-full">
          {startLabel({ running, live })}
        </Button>
      </InstrumentPanel>

      <InstrumentPanel name="pocketbase">
        <Reading label="State">
          <span className={live ? 'text-primary' : 'text-muted-foreground'}>
            {live ? 'active' : running ? stepAt(step).name.toLowerCase() : 'no app yet'}
          </span>
        </Reading>
        <Gauge label="vCPU" used={live ? '0.09' : '—'} total="1" share={live ? RUNNING.cpu : 0} />
        <Gauge
          label="Memory"
          used={live ? '87 MiB' : '—'}
          total="256 MiB"
          share={live ? RUNNING.memory : 0}
        />
        <Gauge
          label="Volume"
          used={live ? '61 MiB' : '—'}
          total="1.0 GiB"
          share={live ? RUNNING.volume : 0}
        />
      </InstrumentPanel>
    </div>
  );
}

function startLabel({ running, live }: { running: boolean; live: boolean }): string {
  if (running) {
    return 'Deploying…';
  }
  return live ? 'Deploy it again' : 'Deploy it';
}

function reached({
  index,
  step,
  running,
  live,
}: {
  index: number;
  step: number;
  running: boolean;
  live: boolean;
}): boolean {
  if (live) {
    return true;
  }
  return running && index <= step;
}

function lampState({
  index,
  step,
  running,
  live,
}: {
  index: number;
  step: number;
  running: boolean;
  live: boolean;
}): 'done' | 'current' | 'waiting' {
  if (live) {
    return 'done';
  }
  if (!running || index > step) {
    return 'waiting';
  }
  return index < step ? 'done' : 'current';
}

function Indicator({ running, live }: { running: boolean; live: boolean }) {
  const lamp = live ? 'bg-primary' : running ? 'animate-pulse bg-warning' : 'bg-border';

  return (
    <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
      <span className={`size-1.5 rounded-full ${lamp}`} />
      {live ? 'live' : running ? 'working' : 'idle'}
    </span>
  );
}

function Lamp({ state }: { state: 'done' | 'current' | 'waiting' }) {
  const fill =
    state === 'done'
      ? 'bg-primary'
      : state === 'current'
        ? 'animate-pulse bg-warning'
        : 'bg-border';

  return (
    <span
      aria-hidden="true"
      className="mt-1.5 flex size-3 shrink-0 items-center justify-center border-2 border-border"
    >
      <span className={`size-1 ${fill}`} />
    </span>
  );
}

type DeployRun = {
  step: number;
  running: boolean;
  live: boolean;
  start: () => void;
};

/**
 * Walks the steps once when started and stops on the last one.
 *
 * One timer re-armed per step rather than an interval: the steps are not the same length, and an
 * interval would have to be the shortest of them with a counter on top.
 */
function useDeployRun(): DeployRun {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) {
      return;
    }
    if (step === LAST_STEP) {
      setRunning(false);
      return;
    }
    const timer = setTimeout(() => setStep((current) => current + 1), stepAt(step).ms);
    return () => clearTimeout(timer);
  }, [running, step]);

  const [everRan, setEverRan] = useState(false);

  function start(): void {
    setEverRan(true);
    setStep(0);
    setRunning(true);
  }

  return { step, running, live: everRan && !running && step === LAST_STEP, start };
}
