import { FileSystem, Path } from '@effect/platform';
import type {
  AppHostname,
  Hostname,
  HostPort,
  HttpPort,
  RestartPolicy,
  TenantArguments,
  TenantEnvironment,
} from '@repo/protocol';
import { Data, Effect, Either } from 'effect';
import { stdoutOf } from '#services/command-runner.service.ts';

export const INSTANCE_ENV_FILENAME = 'instance.env';
export const INSTANCE_CONFIG_IMAGE = 'config.squashfs';

/** Carries the tenant's environment variables, which are secrets. */
const PRIVATE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;

/** The two namespaces the runtime parses, so a tenant variable called NIBRUN_HTTP_PORT stays the tenant's. */
const RUNTIME_PREFIX = 'NIBRUN_';
const TENANT_PREFIX = 'ENV_';

const FORBIDDEN_VALUE_CHARACTERS = /[\n\r\0]/;

// Public rather than the VPC's: the guest network is cut off from every private destination, and
// a resolver inside one would mean opening that back up for whatever else answers on the address.
const DNS_SERVERS = ['1.1.1.1', '1.0.0.1'];

/**
 * The name nibrun issued the app, never one its owner brought: it is the hostname the app is
 * always reachable at, and the only one that cannot be taken away underneath a running binary.
 *
 * Undefined has no meaning beyond a control plane that sent none — the runtime reads the line as
 * optional, which is what lets a host adopt the guest image that reads it before this writes it.
 */
function platformHostname(hostnames: AppHostname[]): Hostname | undefined {
  return hostnames.find((each) => each.kind === 'platform')?.hostname;
}

/**
 * Where a tenant's own port is reached, for an app that asked for one. The two together, because
 * half of what a binary has to announce is not an announcement — and neither half is something a
 * guest can find out for itself: the address belongs to the relay in front of the host, and the
 * ruleset denies the metadata endpoint anyway.
 */
export type PublicAddress = {
  readonly ipv4: string;
  readonly port: HostPort;
};

type InstanceEnvContent = {
  httpPort: HttpPort;
  publicAddress?: PublicAddress | undefined;
  hostnames: AppHostname[];
  args: TenantArguments;
  environment: TenantEnvironment;
  restartPolicy: RestartPolicy;
};

export class UnrepresentableEnvironment extends Data.TaggedError('UnrepresentableEnvironment')<{
  readonly variableName: string;
}> {
  /** Names the variable and never its value, which is the tenant's secret. */
  override get message() {
    return `${this.variableName} has no representation on the config drive`;
  }
}

/**
 * Line-oriented `KEY=VALUE`, so the guest's init needs no parser. A value containing a newline
 * has no representation in a format with no quoting, so it fails the instance rather than
 * truncating somebody's configuration into the next line.
 */
export function renderInstanceEnv({
  httpPort,
  publicAddress,
  hostnames,
  args,
  environment,
  restartPolicy,
}: InstanceEnvContent): Either.Either<string, UnrepresentableEnvironment> {
  const hostname = platformHostname(hostnames);
  const lines = [
    `${RUNTIME_PREFIX}HTTP_PORT=${httpPort}`,
    ...(hostname === undefined ? [] : [`${RUNTIME_PREFIX}HOSTNAME=${hostname}`]),
    ...(publicAddress === undefined
      ? []
      : [
          `${RUNTIME_PREFIX}PUBLIC_IPV4=${publicAddress.ipv4}`,
          `${RUNTIME_PREFIX}EXTRA_PUBLIC_PORT=${publicAddress.port}`,
        ]),
    `${RUNTIME_PREFIX}MAX_RESTARTS=${restartPolicy.maxRestarts}`,
    `${RUNTIME_PREFIX}INITIAL_BACKOFF_MS=${restartPolicy.initialBackoffMs}`,
    `${RUNTIME_PREFIX}MAX_BACKOFF_MS=${restartPolicy.maxBackoffMs}`,
    `${RUNTIME_PREFIX}BACKOFF_FACTOR=${restartPolicy.backoffFactor}`,
    `${RUNTIME_PREFIX}RESET_AFTER_MS=${restartPolicy.resetAfterMs}`,
    `${RUNTIME_PREFIX}DNS=${DNS_SERVERS.join(',')}`,
  ];
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
}: InstanceEnvContent & { workingDir: string }) =>
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
