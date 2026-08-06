import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import {
  parsePropertyBlocks,
  SHOWN_PROPERTIES,
  type UnitStatus,
  unitStatusFrom,
} from '#lib/vm/unit-status.ts';
import { run, stdoutOf } from '#services/command-runner.service.ts';

const SYSTEMCTL = 'systemctl';

/**
 * One systemd template instance per microVM, so Firecracker is a child of init rather than of
 * this agent — which is what makes redeploying the agent a non-event for running tenants.
 */
export const VM_UNIT_TEMPLATE = 'nibrun-vm@';
const UNIT_SUFFIX = '.service';
const UNIT_PATTERN = `${VM_UNIT_TEMPLATE}*${UNIT_SUFFIX}`;

export const vmUnitName = (appId: AppId) => `${VM_UNIT_TEMPLATE}${appId}${UNIT_SUFFIX}`;

export function appIdFromUnit(unitName: string): AppId | undefined {
  if (!unitName.startsWith(VM_UNIT_TEMPLATE) || !unitName.endsWith(UNIT_SUFFIX)) {
    return undefined;
  }
  const value = unitName.slice(VM_UNIT_TEMPLATE.length, -UNIT_SUFFIX.length);
  try {
    return Value.Parse(AppIdSchema, value);
  } catch {
    return undefined;
  }
}

export function parseUnitNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^[^\w]*\s*/, ''))
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((name) => name.endsWith(UNIT_SUFFIX));
}

export const listAppIds = stdoutOf({
  command: [
    SYSTEMCTL,
    'list-units',
    '--type=service',
    '--all',
    '--plain',
    '--no-legend',
    '--no-pager',
    UNIT_PATTERN,
  ],
}).pipe(
  Effect.map((output) =>
    parseUnitNames(output)
      .map(appIdFromUnit)
      .filter((id): id is AppId => id !== undefined),
  ),
  Effect.withSpan('systemd.listAppIds'),
);

export const statuses = Effect.fn('systemd.statuses')(function* (appIds: readonly AppId[]) {
  if (appIds.length === 0) {
    return new Map<AppId, UnitStatus>();
  }
  const result = yield* run({
    command: [
      SYSTEMCTL,
      'show',
      ...appIds.map(vmUnitName),
      `--property=${SHOWN_PROPERTIES.join(',')}`,
    ],
  });
  const blocks = parsePropertyBlocks(result.stdout);
  return new Map(
    [...appIds.entries()].map(([index, appId]) => [
      appId,
      unitStatusFrom(blocks[index] ?? { LoadState: 'not-found', ActiveState: 'inactive' }),
    ]),
  );
});

export const start = Effect.fn('systemd.start')((appId: AppId) =>
  stdoutOf({ command: [SYSTEMCTL, 'start', vmUnitName(appId)] }),
);

export const stop = Effect.fn('systemd.stop')((appId: AppId) =>
  stdoutOf({ command: [SYSTEMCTL, 'stop', vmUnitName(appId)] }),
);

/** An exited template instance stays loaded and failed until reset, and would linger in every enumeration. */
export const forget = Effect.fn('systemd.forget')((appId: AppId) =>
  run({ command: [SYSTEMCTL, 'reset-failed', vmUnitName(appId)] }),
);
