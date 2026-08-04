export type UnitStatus = {
  readonly loaded: boolean;
  readonly active: boolean;
  readonly failed: boolean;
  /** Distinguishes a VM stopped this boot from one that has never run since the host booted. */
  readonly startedThisBoot: boolean;
  readonly exitCode?: number;
};

export const UNKNOWN_UNIT: UnitStatus = {
  loaded: false,
  active: false,
  failed: false,
  startedThisBoot: false,
};

export const SHOWN_PROPERTIES = [
  'LoadState',
  'ActiveState',
  'SubState',
  'Result',
  'ExecMainStatus',
  'InactiveExitTimestampMonotonic',
];

const DECIMAL = 10;
const NEVER_LEFT_INACTIVE = 0;

export function parseProperties(output: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      properties[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return properties;
}

/** `systemctl show` answers for many units in one call, one blank-line-separated block each. */
export function parsePropertyBlocks(output: string): Record<string, string>[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(parseProperties);
}

export function unitStatusFrom(properties: Record<string, string>): UnitStatus {
  const activeState = properties.ActiveState ?? 'inactive';
  const exitCode = Number.parseInt(properties.ExecMainStatus ?? '', DECIMAL);
  // Monotonic, so it resets with the host: the only property that can date a start to this boot.
  const inactiveExit = Number.parseInt(properties.InactiveExitTimestampMonotonic ?? '', DECIMAL);
  return {
    loaded: (properties.LoadState ?? 'not-found') === 'loaded',
    active: activeState === 'active' || activeState === 'activating',
    failed: activeState === 'failed',
    startedThisBoot: Number.isFinite(inactiveExit) && inactiveExit > NEVER_LEFT_INACTIVE,
    ...(Number.isFinite(exitCode) ? { exitCode } : {}),
  };
}
