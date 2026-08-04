import { FileSystem, Path } from '@effect/platform';
import type { GuestPort, RestartPolicy, TenantArguments, TenantEnvironment } from '@repo/protocol';
import { Data, Effect, Either } from 'effect';
import { stdoutOf } from '#lib/exec.ts';

export const INSTANCE_ENV_FILENAME = 'instance.env';
export const INSTANCE_CONFIG_IMAGE = 'config.squashfs';

/** Carries the tenant's environment variables, which are secrets. */
const PRIVATE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

/** The two namespaces the runtime parses, so a tenant variable called NIBRUN_PORT stays the tenant's. */
const RUNTIME_PREFIX = 'NIBRUN_';
const TENANT_PREFIX = 'ENV_';

const FORBIDDEN_VALUE_CHARACTERS = /[\n\r\0]/;

export class UnrepresentableEnvironment extends Data.TaggedError('UnrepresentableEnvironment')<{
  readonly variableName: string;
}> {}

/**
 * Line-oriented `KEY=VALUE`, so the guest's init needs no parser. A value containing a newline
 * has no representation in a format with no quoting, so it fails the instance rather than
 * truncating somebody's configuration into the next line.
 */
export function renderInstanceEnv({
  guestPort,
  args,
  environment,
  restartPolicy,
  dnsServers,
}: {
  guestPort: GuestPort;
  args: TenantArguments;
  environment: TenantEnvironment;
  restartPolicy: RestartPolicy;
  dnsServers: readonly string[];
}): Either.Either<string, UnrepresentableEnvironment> {
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
  // Numbered rather than delimited: a format with no quoting cannot carry a separator an
  // argument might itself contain, and the guest refuses a gap rather than shifting the rest down.
  for (const [index, argument] of args.entries()) {
    if (FORBIDDEN_VALUE_CHARACTERS.test(argument)) {
      return Either.left(
        new UnrepresentableEnvironment({ variableName: `${RUNTIME_PREFIX}ARG_${index}` }),
      );
    }
    lines.push(`${RUNTIME_PREFIX}ARG_${index}=${argument}`);
  }
  for (const key of Object.keys(environment).sort()) {
    const value = environment[key] ?? '';
    if (FORBIDDEN_VALUE_CHARACTERS.test(value)) {
      return Either.left(new UnrepresentableEnvironment({ variableName: key }));
    }
    lines.push(`${TENANT_PREFIX}${key}=${value}`);
  }
  return Either.right(`${lines.join('\n')}\n`);
}

/** Rebuilt on every boot, because configuration changes without the artifact changing. */
export const buildInstanceConfigImage = ({
  workingDir,
  ...content
}: {
  workingDir: string;
  guestPort: GuestPort;
  args: TenantArguments;
  environment: TenantEnvironment;
  restartPolicy: RestartPolicy;
  dnsServers: readonly string[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stagingDir = path.join(workingDir, '.config-staging');
    const imagePath = path.join(workingDir, INSTANCE_CONFIG_IMAGE);
    const rendered = yield* renderInstanceEnv(content);

    return yield* Effect.acquireUseRelease(
      fs
        .remove(stagingDir, { recursive: true, force: true })
        .pipe(
          Effect.andThen(fs.makeDirectory(stagingDir, { recursive: true, mode: PRIVATE_DIR_MODE })),
        ),
      () =>
        Effect.gen(function* () {
          yield* fs.writeFileString(path.join(stagingDir, INSTANCE_ENV_FILENAME), rendered, {
            mode: PRIVATE_MODE,
          });
          yield* fs.remove(imagePath, { force: true });
          yield* stdoutOf({
            command: [
              'mksquashfs',
              stagingDir,
              imagePath,
              '-no-progress',
              '-noappend',
              '-all-root',
            ],
          });
          yield* fs.chmod(imagePath, PRIVATE_MODE);
          return imagePath;
        }),
      () => fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
    );
  });
