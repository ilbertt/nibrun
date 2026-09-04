import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { DEFAULT_INSTANCE_RESOURCES, DEFAULT_VOLUME_SIZE_BYTES } from '@repo/protocol';

const BYTES_PER_GIB = 1_073_741_824;
const MIB_PER_GIB = 1024;

const VCPU_STEP_COUNT = 4;
const MEMORY_STEP_COUNT = 5;
const VOLUME_STEP_COUNT = 5;

const DOUBLING = 2;

const PRICE_PER_EXTRA_VCPU_USD = 2;
const PRICE_PER_MEMORY_DOUBLING_USD = 1;
const PRICE_PER_VOLUME_DOUBLING_USD = 0.5;

// What the room holds in total. Eight default apps fit with headroom to grow a few of them,
// which is the tradeoff worth making rather than a wall nobody ever reaches.
const FLEET_VCPU_LIMIT = 12;
const FLEET_MEMORY_MIB_LIMIT = 8192;
const FLEET_VOLUME_GIB_LIMIT = 384;

const USD_DECIMALS = 2;

function stepsFrom({
  start,
  count,
  next,
}: {
  start: number;
  count: number;
  next: (value: number) => number;
}): number[] {
  const values = [start];
  while (values.length < count) {
    values.push(next(values[values.length - 1]!));
  }
  return values;
}

function increment(value: number): number {
  return value + 1;
}

function double(value: number): number {
  return value * DOUBLING;
}

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

function formatCount(value: number): string {
  return `${value}`;
}

function formatMemory(mib: number): string {
  return mib < MIB_PER_GIB ? `${mib} MiB` : `${mib / MIB_PER_GIB} GiB`;
}

function formatVolume(gib: number): string {
  return `${gib} GiB`;
}

type Axis = {
  name: string;
  steps: number[];
  format: (value: number) => string;
  pricePerStep: number;
  fleetLimit: number;
};

/** Every axis starts at what an app is given today, so the first tick is the machine we ship. */
export const AXES = {
  vcpu: {
    name: 'vCPU',
    steps: stepsFrom({
      start: DEFAULT_INSTANCE_RESOURCES.vcpuCount,
      count: VCPU_STEP_COUNT,
      next: increment,
    }),
    format: formatCount,
    pricePerStep: PRICE_PER_EXTRA_VCPU_USD,
    fleetLimit: FLEET_VCPU_LIMIT,
  },
  memory: {
    name: 'RAM',
    steps: stepsFrom({
      start: DEFAULT_INSTANCE_RESOURCES.memoryMib,
      count: MEMORY_STEP_COUNT,
      next: double,
    }),
    format: formatMemory,
    pricePerStep: PRICE_PER_MEMORY_DOUBLING_USD,
    fleetLimit: FLEET_MEMORY_MIB_LIMIT,
  },
  volume: {
    name: 'disk',
    steps: stepsFrom({
      start: DEFAULT_VOLUME_SIZE_BYTES / BYTES_PER_GIB,
      count: VOLUME_STEP_COUNT,
      next: double,
    }),
    format: formatVolume,
    pricePerStep: PRICE_PER_VOLUME_DOUBLING_USD,
    fleetLimit: FLEET_VOLUME_GIB_LIMIT,
  },
} satisfies Record<string, Axis>;

export type AxisKey = keyof typeof AXES;

export const AXIS_KEYS = Object.keys(AXES) as AxisKey[];

export type AppSpec = {
  /** Identity and seed for the name and the tint, so a box keeps both for as long as it lives. */
  ordinal: number;
  name: string;
  tint: string;
  steps: Record<AxisKey, number>;
};

export function stepValue({ axisKey, step }: { axisKey: AxisKey; step: number }): number {
  return AXES[axisKey].steps[step]!;
}

export function upgradesPrice(app: AppSpec): number {
  return sum(AXIS_KEYS.map((key) => app.steps[key] * AXES[key].pricePerStep));
}

/** The base is on the house for the first apps in the list; what they were upgraded to is not. */
export function appPrice({ app, index }: { app: AppSpec; index: number }): number {
  const base = index < FREE_APPS_COUNT ? 0 : PRICE_PER_APP_USD;
  return base + upgradesPrice(app);
}

export function fleetPrice(apps: AppSpec[]): number {
  return sum([...apps.entries()].map(([index, app]) => appPrice({ app, index })));
}

export function usedOn({ apps, axisKey }: { apps: AppSpec[]; axisKey: AxisKey }): number {
  return sum(apps.map((app) => stepValue({ axisKey, step: app.steps[axisKey] })));
}

function allowanceOn({
  apps,
  app,
  axisKey,
}: {
  apps: AppSpec[];
  app: AppSpec;
  axisKey: AxisKey;
}): number {
  const others = apps.filter((other) => other.ordinal !== app.ordinal);
  return AXES[axisKey].fleetLimit - usedOn({ apps: others, axisKey });
}

/** The largest value this app may still take on each axis, with the rest of the room deducted. */
export function allowancesFor({
  apps,
  app,
}: {
  apps: AppSpec[];
  app: AppSpec;
}): Record<AxisKey, number> {
  return {
    vcpu: allowanceOn({ apps, app, axisKey: 'vcpu' }),
    memory: allowanceOn({ apps, app, axisKey: 'memory' }),
    volume: allowanceOn({ apps, app, axisKey: 'volume' }),
  };
}

export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(USD_DECIMALS)}`;
}

const APP_NAMES = [
  'hello-world',
  'todo-final',
  'todo-final-2',
  'sqlite-empire',
  'weekend-project',
  'definitely-temporary',
  'the-cron-job',
  'pocketbase-again',
];

// Flavours of the brand green rather than a categorical palette: close enough to stay one family,
// far enough apart to tell two boxes standing next to each other apart.
const BOX_TINTS = [
  'var(--primary)',
  'oklch(0.7 0.15 168)',
  'oklch(0.52 0.13 136)',
  'oklch(0.66 0.18 127)',
  'oklch(0.75 0.13 152)',
  'oklch(0.48 0.12 160)',
  'oklch(0.61 0.14 181)',
  'oklch(0.56 0.16 141)',
];

export const MAX_APPS = APP_NAMES.length;

const DEFAULT_STEPS: Record<AxisKey, number> = { vcpu: 0, memory: 0, volume: 0 };

export function createApp({
  ordinal,
  steps = DEFAULT_STEPS,
}: {
  ordinal: number;
  steps?: Record<AxisKey, number>;
}): AppSpec {
  const name = APP_NAMES[ordinal % APP_NAMES.length]!;
  const round = Math.floor(ordinal / APP_NAMES.length);
  return {
    ordinal,
    name: round === 0 ? name : `${name}-${round + 1}`,
    tint: BOX_TINTS[ordinal % BOX_TINTS.length]!,
    steps,
  };
}

export function fitsAnotherApp(apps: AppSpec[]): boolean {
  return AXIS_KEYS.every(
    (axisKey) =>
      usedOn({ apps, axisKey }) + stepValue({ axisKey, step: 0 }) <= AXES[axisKey].fleetLimit,
  );
}

/** One box at what an app actually ships with, which is also what it costs nothing to run. */
export function initialApps(): AppSpec[] {
  return [createApp({ ordinal: 0 })];
}

export function nextOrdinalAfter(apps: AppSpec[]): number {
  return Math.max(-1, ...apps.map((app) => app.ordinal)) + 1;
}

const STORAGE_KEY = 'nibrun:calculator';

type StoredApp = { ordinal: number; steps: Record<AxisKey, number> };

function isStoredApp(value: unknown): value is StoredApp {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { ordinal, steps } = value as Partial<StoredApp>;
  return (
    Number.isInteger(ordinal) &&
    (ordinal as number) >= 0 &&
    typeof steps === 'object' &&
    steps !== null &&
    AXIS_KEYS.every((axisKey) => Number.isInteger(steps[axisKey]))
  );
}

function clampedStep({ axisKey, step }: { axisKey: AxisKey; step: number }): number {
  return Math.min(Math.max(step, 0), AXES[axisKey].steps.length - 1);
}

// The store is the reader's own file and may be anything by the time it comes back, so a box is
// rebuilt from nothing but its ordinal and three clamped steps, and dropped if the room is full.
function restoreApp({ stored, sofar }: { stored: StoredApp; sofar: AppSpec[] }): AppSpec | null {
  const app = createApp({
    ordinal: stored.ordinal,
    steps: {
      vcpu: clampedStep({ axisKey: 'vcpu', step: stored.steps.vcpu }),
      memory: clampedStep({ axisKey: 'memory', step: stored.steps.memory }),
      volume: clampedStep({ axisKey: 'volume', step: stored.steps.volume }),
    },
  });
  const room = [...sofar, app];
  const fits = AXIS_KEYS.every(
    (axisKey) => usedOn({ apps: room, axisKey }) <= AXES[axisKey].fleetLimit,
  );
  return fits ? app : null;
}

export function readStoredApps(): AppSpec[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const apps: AppSpec[] = [];
    for (const stored of parsed.slice(0, MAX_APPS)) {
      const app = isStoredApp(stored) ? restoreApp({ stored, sofar: apps }) : null;
      if (app !== null) {
        apps.push(app);
      }
    }
    return apps.length > 0 ? apps : null;
  } catch {
    return null;
  }
}

export function writeStoredApps(apps: AppSpec[]): void {
  const stored: StoredApp[] = apps.map((app) => ({ ordinal: app.ordinal, steps: app.steps }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A browser refusing to store is not worth telling anyone about.
  }
}
