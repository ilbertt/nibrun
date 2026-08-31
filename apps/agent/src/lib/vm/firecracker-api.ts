import { Data, Duration, Effect, Schedule } from 'effect';
import { describe } from '#lib/failure.ts';

/**
 * The per-VM API socket `nibrun-vm@.service` has always given every microVM, and which nothing
 * spoke to until there was a reason to pause one. The boot config is read once and never again,
 * so everything after boot — pausing, snapshotting, restoring — happens here.
 *
 * Shapes are Firecracker 1.16.1's, off the swagger that release ships. Two of them are worth
 * naming because a neighbouring version differs: `/vm` mounts `PATCH` and only `PATCH`, for
 * `Paused` and `Resumed` alike, and `sync_snapshot_files` does not exist here — 1.16.1 always
 * syncs. A body Firecracker does not recognise is rejected outright, so a field invented for a
 * later version fails the call rather than being ignored.
 */
const API_ORIGIN = 'http://localhost';
const VM_PATH = '/vm';
const SNAPSHOT_CREATE_PATH = '/snapshot/create';
const SNAPSHOT_LOAD_PATH = '/snapshot/load';

const NO_CONTENT = 204;
const MAX_DETAIL_LENGTH = 200;

/** A 256 MiB guest measures ~1.7s to snapshot, and is paused for every millisecond of it. */
const CALL_TIMEOUT = Duration.seconds(60);

/** Firecracker binds its API socket after `exec`, and systemd calls a `Type=exec` unit started at it. */
const BIND_POLL_INTERVAL = Duration.millis(10);
const BIND_TIMEOUT = Duration.seconds(10);

export class FirecrackerUnreachable extends Data.TaggedError('FirecrackerUnreachable')<{
  readonly socketPath: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `no microVM answered ${this.socketPath}: ${describe(this.cause)}`;
  }
}

export class FirecrackerRejected extends Data.TaggedError('FirecrackerRejected')<{
  readonly path: string;
  readonly status: number;
  readonly detail: string;
}> {
  override get message() {
    const reason = this.detail.length > 0 ? `: ${this.detail}` : '';
    return `the microVM refused ${this.path} with ${this.status}${reason}`;
  }
}

export type FirecrackerApiError = FirecrackerUnreachable | FirecrackerRejected;

type ApiCall = {
  readonly socketPath: string;
  readonly method: 'PATCH' | 'PUT';
  readonly path: string;
  readonly body: unknown;
};

const call = ({ socketPath, method, path, body }: ApiCall) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${API_ORIGIN}${path}`, {
          unix: socketPath,
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }),
      catch: (cause) => new FirecrackerUnreachable({ socketPath, cause }),
    });
    if (response.status === NO_CONTENT) {
      return;
    }
    // Every refusal is a `fault_message`, and a body that is not one is still the only account of
    // itself the VMM gave.
    const detail = yield* Effect.orElseSucceed(
      Effect.tryPromise(() => response.text()),
      () => '',
    );
    return yield* new FirecrackerRejected({
      path,
      status: response.status,
      detail: detail.trim().slice(0, MAX_DETAIL_LENGTH),
    });
  }).pipe(
    Effect.timeoutFail({
      duration: CALL_TIMEOUT,
      onTimeout: () =>
        new FirecrackerUnreachable({
          socketPath,
          cause: `${path} did not answer within ${Duration.toSeconds(CALL_TIMEOUT)}s`,
        }),
    }),
    Effect.withSpan('firecracker', { attributes: { path } }),
  );

/**
 * A call to a Firecracker that has only just been started has to be prepared to find nothing
 * listening yet. Only a connection that never completed is repeated: a refusal is the VMM's
 * answer, and asking again does not change it.
 */
const untilBound = <A>(effect: Effect.Effect<A, FirecrackerApiError>) =>
  Effect.retry(effect, {
    while: (error: FirecrackerApiError) => error._tag === 'FirecrackerUnreachable',
    schedule: Schedule.spaced(BIND_POLL_INTERVAL).pipe(Schedule.upTo(BIND_TIMEOUT)),
  });

export const pause = Effect.fn('firecracker.pause')((socketPath: string) =>
  call({ socketPath, method: 'PATCH', path: VM_PATH, body: { state: 'Paused' } }),
);

export const resume = Effect.fn('firecracker.resume')((socketPath: string) =>
  call({ socketPath, method: 'PATCH', path: VM_PATH, body: { state: 'Resumed' } }),
);

export type SnapshotFiles = {
  readonly socketPath: string;
  readonly statePath: string;
  readonly memoryPath: string;
};

/** Both files are created or truncated by this, and the microVM has to be paused already. */
export const createSnapshot = Effect.fn('firecracker.createSnapshot')(
  ({ socketPath, statePath, memoryPath }: SnapshotFiles) =>
    call({
      socketPath,
      method: 'PUT',
      path: SNAPSHOT_CREATE_PATH,
      body: {
        snapshot_path: statePath,
        mem_file_path: memoryPath,
        snapshot_type: 'Full',
      },
    }),
);

/**
 * Accepted only by a Firecracker that has configured nothing, which is why a restore is started
 * without a config file. It leaves the microVM paused; resuming it is a call of its own.
 *
 * `mem_backend` rather than the `mem_file_path` beside it: that spelling is deprecated upstream
 * and the two are mutually exclusive, so sending both is a rejection rather than a preference.
 *
 * `clock_realtime` is not a refinement. Firecracker emulates no RTC on x86_64, so kvmclock is the
 * guest's only source of wall time — `infra/guest-image/kernel/nibrun.config` builds a kernel with
 * `CONFIG_PARAVIRT_CLOCK` and nothing else to fall back on. Its default of `false` resumes the
 * clock where the snapshot left it, so a guest that slept an hour wakes an hour in the past and
 * its first outbound TLS handshake fails on a certificate that is not yet valid — a wrong answer
 * from a healthy-looking app rather than a microVM that visibly did not come up. This one field
 * is what makes a sleep invisible to the guest, and it is why waking needs no new guest image.
 */
export const loadSnapshot = Effect.fn('firecracker.loadSnapshot')(
  ({ socketPath, statePath, memoryPath }: SnapshotFiles) =>
    untilBound(
      call({
        socketPath,
        method: 'PUT',
        path: SNAPSHOT_LOAD_PATH,
        body: {
          snapshot_path: statePath,
          mem_backend: { backend_type: 'File', backend_path: memoryPath },
          clock_realtime: true,
        },
      }),
    ),
);
