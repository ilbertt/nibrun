import { type InstanceId, InstanceIdSchema, isValidMessage } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

const SYSTEMCTL = 'systemctl';

/**
 * One systemd template instance per microVM, so Firecracker is a child of init and not of this
 * agent.
 *
 * The agent is the component that updates most often. If the VMs were its children, every
 * agent restart would kill every tenant app on the host — which would make the one operation
 * that has to be routine the most dangerous one. Parented to init, an agent restart is a
 * non-event and an operator can inspect a single app with `systemctl status` and `journalctl`.
 */
export const VM_UNIT_TEMPLATE = 'nibrun-vm@';
const UNIT_SUFFIX = '.service';
const UNIT_PATTERN = `${VM_UNIT_TEMPLATE}*${UNIT_SUFFIX}`;

export const vmUnitName = (instanceId: InstanceId) =>
  `${VM_UNIT_TEMPLATE}${instanceId}${UNIT_SUFFIX}`;

// Instance ids are alphanumerics, hyphens and underscores, none of which systemd escapes, so
// the unit name carries the id verbatim in both directions.
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

export function parseProperties(output: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    properties[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return properties;
}

// `systemctl show` answers for several units in one call, emitting one block per unit in the
// order asked and separating them with a blank line. One subprocess per status sweep rather
// than one per instance is the difference between a poll that scales to a full host and one
// that does not.
export function parsePropertyBlocks(output: string): Record<string, string>[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(parseProperties);
}

export type UnitStatus = {
  loaded: boolean;
  active: boolean;
  failed: boolean;
  exitCode?: number;
};

const SHOWN_PROPERTIES = ['LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus'];

export function unitStatusFrom(properties: Record<string, string>): UnitStatus {
  const loadState = properties.LoadState ?? 'not-found';
  const activeState = properties.ActiveState ?? 'inactive';
  const exitCode = Number.parseInt(properties.ExecMainStatus ?? '', 10);
  return {
    loaded: loadState === 'loaded',
    active: activeState === 'active' || activeState === 'activating',
    failed: activeState === 'failed',
    ...(Number.isFinite(exitCode) ? { exitCode } : {}),
  };
}

export class SystemdVmUnits {
  readonly #runner: CommandRunner;

  constructor({ runner }: { runner: CommandRunner }) {
    this.#runner = runner;
  }

  async listInstanceIds(): Promise<InstanceId[]> {
    const output = await runCommandOrThrow({
      runner: this.#runner,
      request: {
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
      },
    });
    return parseUnitNames(output)
      .map(instanceIdFromUnit)
      .filter((id): id is InstanceId => id !== undefined);
  }

  async statuses(instanceIds: readonly InstanceId[]): Promise<Map<InstanceId, UnitStatus>> {
    const statuses = new Map<InstanceId, UnitStatus>();
    if (instanceIds.length === 0) {
      return statuses;
    }
    const result = await this.#runner({
      command: [
        SYSTEMCTL,
        'show',
        ...instanceIds.map(vmUnitName),
        `--property=${SHOWN_PROPERTIES.join(',')}`,
      ],
    });
    const blocks = parsePropertyBlocks(result.stdout);
    for (const [index, instanceId] of instanceIds.entries()) {
      const block = blocks[index] ?? { LoadState: 'not-found', ActiveState: 'inactive' };
      statuses.set(instanceId, unitStatusFrom(block));
    }
    return statuses;
  }

  async start(instanceId: InstanceId): Promise<void> {
    await runCommandOrThrow({
      runner: this.#runner,
      request: { command: [SYSTEMCTL, 'start', vmUnitName(instanceId)] },
    });
  }

  async stop(instanceId: InstanceId): Promise<void> {
    await runCommandOrThrow({
      runner: this.#runner,
      request: { command: [SYSTEMCTL, 'stop', vmUnitName(instanceId)] },
    });
  }

  // A template instance that exited stays loaded and `failed` until it is reset, which would
  // otherwise make an instance the control plane has forgotten linger in every enumeration.
  async forget(instanceId: InstanceId): Promise<void> {
    await this.#runner({ command: [SYSTEMCTL, 'reset-failed', vmUnitName(instanceId)] });
  }
}
