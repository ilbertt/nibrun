import { type InstanceId, InstanceIdSchema, isValidMessage } from '@repo/protocol';
import { Effect } from 'effect';
import { run, stdoutOf } from '#services/command-runner.service.ts';
import {
  parsePropertyBlocks,
  SHOWN_PROPERTIES,
  type UnitStatus,
  unitStatusFrom,
} from '#vm/unit-status.ts';

const SYSTEMCTL = 'systemctl';

/**
 * One systemd template instance per microVM, so Firecracker is a child of init rather than of
 * this agent — which is what makes redeploying the agent a non-event for running tenants.
 */
export const VM_UNIT_TEMPLATE = 'nibrun-vm@';
const UNIT_SUFFIX = '.service';
const UNIT_PATTERN = `${VM_UNIT_TEMPLATE}*${UNIT_SUFFIX}`;

export const vmUnitName = (instanceId: InstanceId) =>
  `${VM_UNIT_TEMPLATE}${instanceId}${UNIT_SUFFIX}`;

export function instanceIdFromUnit(unitName: string): InstanceId | undefined {
  if (!unitName.startsWith(VM_UNIT_TEMPLATE) || !unitName.endsWith(UNIT_SUFFIX)) {
    return undefined;
  }
  const value = unitName.slice(VM_UNIT_TEMPLATE.length, -UNIT_SUFFIX.length);
  return isValidMessage({ schema: InstanceIdSchema, value }) ? (value as InstanceId) : undefined;
}

export function parseUnitNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^[^\w]*\s*/, ''))
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((name) => name.endsWith(UNIT_SUFFIX));
}

export const listInstanceIds = stdoutOf({
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
      .map(instanceIdFromUnit)
      .filter((id): id is InstanceId => id !== undefined),
  ),
  Effect.withSpan('systemd.listInstanceIds'),
);

export const statuses = Effect.fn('systemd.statuses')(function* (
  instanceIds: readonly InstanceId[],
) {
  if (instanceIds.length === 0) {
    return new Map<InstanceId, UnitStatus>();
  }
  const result = yield* run({
    command: [
      SYSTEMCTL,
      'show',
      ...instanceIds.map(vmUnitName),
      `--property=${SHOWN_PROPERTIES.join(',')}`,
    ],
  });
  const blocks = parsePropertyBlocks(result.stdout);
  return new Map(
    [...instanceIds.entries()].map(([index, instanceId]) => [
      instanceId,
      unitStatusFrom(blocks[index] ?? { LoadState: 'not-found', ActiveState: 'inactive' }),
    ]),
  );
});

export const start = Effect.fn('systemd.start')((instanceId: InstanceId) =>
  stdoutOf({ command: [SYSTEMCTL, 'start', vmUnitName(instanceId)] }),
);

export const stop = Effect.fn('systemd.stop')((instanceId: InstanceId) =>
  stdoutOf({ command: [SYSTEMCTL, 'stop', vmUnitName(instanceId)] }),
);

/** An exited template instance stays loaded and failed until reset, and would linger in every enumeration. */
export const forget = Effect.fn('systemd.forget')((instanceId: InstanceId) =>
  run({ command: [SYSTEMCTL, 'reset-failed', vmUnitName(instanceId)] }),
);
