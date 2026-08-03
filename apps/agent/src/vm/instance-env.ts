import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuestPort, RestartPolicy, TenantEnvironment } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

// Line-oriented `KEY=VALUE`, so the guest's init needs no parser. The file is generated and
// never hand-edited, which is what lets the format be this thin.
export const INSTANCE_ENV_FILENAME = 'instance.env';
export const INSTANCE_CONFIG_IMAGE = 'config.squashfs';

// Carries the tenant's environment variables, which are secrets. Readable only by the user the
// agent and Firecracker run as.
const PRIVATE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

// The two namespaces apps/runtime parses, and it accepts nothing outside them. They exist so
// the two can never collide: a tenant variable actually called NIBRUN_PORT arrives as
// ENV_NIBRUN_PORT and stays the tenant's.
const RUNTIME_PREFIX = 'NIBRUN_';
const TENANT_PREFIX = 'ENV_';

const FORBIDDEN_VALUE_CHARACTERS = /[\n\r\0]/;

export class UnrepresentableEnvironmentError extends Error {
  readonly name_: string;

  constructor(variableName: string) {
    super(`Environment variable ${variableName} cannot be represented in instance.env`);
    this.name = 'UnrepresentableEnvironmentError';
    this.name_ = variableName;
  }
}

/**
 * Renders what the guest's init reads off its config drive.
 *
 * The runtime carries no defaults for any `NIBRUN_` key and rejects a file missing one, so
 * every value it needs is resolved here — the restart policy included, which is the guest's
 * budget for the tenant process rather than anything this agent acts on.
 *
 * A value containing a newline has no representation in a format with no quoting, so it fails
 * the instance rather than silently truncating somebody's configuration into the next line —
 * and a second line could not carry a prefix, which is how the guest catches the same thing.
 */
export function renderInstanceEnv({
  guestPort,
  environment,
  restartPolicy,
  dnsServers,
}: {
  guestPort: GuestPort;
  environment: TenantEnvironment;
  restartPolicy: RestartPolicy;
  dnsServers: readonly string[];
}): string {
  const lines = [
    `${RUNTIME_PREFIX}PORT=${guestPort}`,
    `${RUNTIME_PREFIX}MAX_RESTARTS=${restartPolicy.maxRestarts}`,
    `${RUNTIME_PREFIX}INITIAL_BACKOFF_MS=${restartPolicy.initialBackoffMs}`,
    `${RUNTIME_PREFIX}MAX_BACKOFF_MS=${restartPolicy.maxBackoffMs}`,
    `${RUNTIME_PREFIX}BACKOFF_FACTOR=${restartPolicy.backoffFactor}`,
    `${RUNTIME_PREFIX}RESET_AFTER_MS=${restartPolicy.resetAfterMs}`,
  ];
  if (dnsServers.length > 0) {
    lines.push(`${RUNTIME_PREFIX}DNS=${dnsServers.join(',')}`);
  }
  for (const key of Object.keys(environment).sort()) {
    const value = environment[key] ?? '';
    if (FORBIDDEN_VALUE_CHARACTERS.test(value)) {
      throw new UnrepresentableEnvironmentError(key);
    }
    lines.push(`${TENANT_PREFIX}${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Builds the read-only squashfs the guest attaches as `vdc`, rebuilt on every boot because the
 * app's configuration can change without its artifact changing.
 */
export async function buildInstanceConfigImage({
  runner,
  workingDir,
  guestPort,
  environment,
  restartPolicy,
  dnsServers,
}: {
  runner: CommandRunner;
  workingDir: string;
  guestPort: GuestPort;
  environment: TenantEnvironment;
  restartPolicy: RestartPolicy;
  dnsServers: readonly string[];
}): Promise<string> {
  const stagingDir = join(workingDir, '.config-staging');
  const imagePath = join(workingDir, INSTANCE_CONFIG_IMAGE);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    await writeFile(
      join(stagingDir, INSTANCE_ENV_FILENAME),
      renderInstanceEnv({ guestPort, environment, restartPolicy, dnsServers }),
      {
        mode: PRIVATE_MODE,
      },
    );
    await rm(imagePath, { force: true });
    await runCommandOrThrow({
      runner,
      request: {
        command: ['mksquashfs', stagingDir, imagePath, '-no-progress', '-noappend', '-all-root'],
      },
    });
    await chmod(imagePath, PRIVATE_MODE);
    return imagePath;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
