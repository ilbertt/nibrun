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
  },
} satisfies Record<string, Axis>;

export type AxisKey = keyof typeof AXES;

export const AXIS_KEYS = Object.keys(AXES) as AxisKey[];

export type AppSpec = {
  id: string;
  name: string;
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
    id: `app-${ordinal}`,
    name: round === 0 ? name : `${name}-${round + 1}`,
    steps,
  };
}

/** Seeded with a spread rather than three identical cubes, so the axes read on first paint. */
export function initialApps(): AppSpec[] {
  return [
    createApp({ ordinal: 0 }),
    createApp({ ordinal: 1, steps: { vcpu: 1, memory: 2, volume: 2 } }),
    createApp({ ordinal: 2, steps: { vcpu: 2, memory: 3, volume: 3 } }),
  ];
}

export const INITIAL_APP_COUNT = initialApps().length;
