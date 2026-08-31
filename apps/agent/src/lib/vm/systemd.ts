import { join } from 'node:path';
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

/**
 * Where `nibrun-vm@.service` tells Firecracker to bind its API socket. Nothing compares the two
 * spellings, so moving one is moving the other — and the unit's runtime directory outlives the
 * agent on purpose, which is what leaves a VM started by an earlier agent still reachable here.
 */
export const vmApiSocketPath = ({ runtimeDir, appId }: { runtimeDir: string; appId: AppId }) =>
  join(runtimeDir, `vm-${appId}.sock`);

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

const JOURNALCTL = 'journalctl';

/**
 * The prefix `apps/runtime` writes its console diagnostics with, from `src/log.c`. Nothing
 * compares the two, so renaming it there is also a change here.
 */
const GUEST_LOG_PREFIX = '[nibrun] ';

/** Only the tail is ever wanted, and a guest that crash-looped can have written a great many. */
const CONSOLE_TAIL_LINES = 200;
const MS_PER_SECOND = 1000;

/**
 * The last thing the guest's own init said.
 *
 * `/init` ends every way it can stop with a line saying which one it took, so the last of them
 * is its verdict — and reading only that keeps this from carrying a second copy of the runtime's
 * vocabulary around.
 */
export function lastGuestLine(output: string): string | undefined {
  const lines = output.split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim() ?? '';
    if (line.startsWith(GUEST_LOG_PREFIX)) {
      return line.slice(GUEST_LOG_PREFIX.length);
    }
  }
  return undefined;
}

/**
 * Why the guest powered itself off, off the console systemd captured for this microVM.
 *
 * Bounded to the run that began at `sinceMs`: a redeploy reuses the unit name, so this unit's
 * journal still holds every earlier deployment's console and the newest line in it may belong to
 * one of those. Answers `undefined` rather than failing — a verdict is an improvement on the exit
 * code, not something the reconciler can be blocked on.
 */
export const guestVerdict = Effect.fn('systemd.guestVerdict')(
  ({ appId, sinceMs }: { appId: AppId; sinceMs: number }) =>
    run({
      command: [
        JOURNALCTL,
        '--unit',
        vmUnitName(appId),
        '--since',
        `@${Math.floor(sinceMs / MS_PER_SECOND)}`,
        '--lines',
        String(CONSOLE_TAIL_LINES),
        '--output',
        'cat',
        '--no-pager',
      ],
    }).pipe(
      Effect.map((result) => lastGuestLine(result.stdout)),
      Effect.orElseSucceed(() => undefined),
    ),
);
