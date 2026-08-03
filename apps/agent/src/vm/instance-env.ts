import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuestPort, TenantEnvironment } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

// Line-oriented `KEY=VALUE`, so the guest's init needs no parser. The file is generated and
// never hand-edited, which is what lets the format be this thin.
export const INSTANCE_ENV_FILENAME = 'instance.env';
export const INSTANCE_CONFIG_IMAGE = 'config.squashfs';

// Carries the tenant's environment variables, which are secrets. Readable only by the user the
// agent and Firecracker run as.
const PRIVATE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

const PORT_VARIABLE = 'PORT';
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
 * Renders the tenant's environment for the guest.
 *
 * `PORT` is written from the port the app declared and a tenant value for it is dropped: that
 * number is what the host forwards to, so letting the tenant override it would produce a VM
 * nothing can reach and no error anywhere.
 *
 * A value containing a newline has no representation in a format with no quoting, so it fails
 * the instance rather than silently truncating somebody's configuration into the next line.
 */
export function renderInstanceEnv({
  guestPort,
  environment,
}: {
  guestPort: GuestPort;
  environment: TenantEnvironment;
}): string {
  const lines = [`${PORT_VARIABLE}=${guestPort}`];
  for (const key of Object.keys(environment).sort()) {
    if (key === PORT_VARIABLE) {
      continue;
    }
    const value = environment[key] ?? '';
    if (FORBIDDEN_VALUE_CHARACTERS.test(value)) {
      throw new UnrepresentableEnvironmentError(key);
    }
    lines.push(`${key}=${value}`);
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
}: {
  runner: CommandRunner;
  workingDir: string;
  guestPort: GuestPort;
  environment: TenantEnvironment;
}): Promise<string> {
  const stagingDir = join(workingDir, '.config-staging');
  const imagePath = join(workingDir, INSTANCE_CONFIG_IMAGE);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    await writeFile(
      join(stagingDir, INSTANCE_ENV_FILENAME),
      renderInstanceEnv({ guestPort, environment }),
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
