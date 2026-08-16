import type { AppId } from '@repo/protocol';
import { Data, Duration, Effect, Option } from 'effect';
import {
  connectRequest,
  dialGuest,
  GUEST_CONTROL_VSOCK_PORT,
  type GuestWire,
  guestVsockPath,
  readConnectReply,
  vmWorkingDir,
} from '#lib/vm/vsock.ts';

const FREEZE_REQUEST = 'FREEZE\n';
const FREEZE_HELD = 'OK';
/** The guest answers a freeze once ext4 has checkpointed its journal, which is work, not a round trip. */
const REPLY_TIMEOUT_SECONDS = 30;
const REPLY_TIMEOUT = Duration.seconds(REPLY_TIMEOUT_SECONDS);

export class GuestUnreachable extends Data.TaggedError('GuestUnreachable')<{
  readonly socketPath: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `no VMM is listening on ${this.socketPath}`;
  }
}

export class GuestSilent extends Data.TaggedError('GuestSilent')<{
  readonly socketPath: string;
}> {
  override get message() {
    return `${this.socketPath} took the request and never answered`;
  }
}

export class FreezeRefused extends Data.TaggedError('FreezeRefused')<{
  readonly appId: AppId;
  readonly reply: string;
}> {
  override get message() {
    return `the guest running ${this.appId} would not freeze its filesystem: ${this.reply}`;
  }
}

/**
 * The guest thaws itself if a freeze is held past its ceiling, and a bundle read across that
 * moment is one whose tail the tenant was free to change underneath. Reported as a failed export
 * rather than uploaded, because the point of freezing is that nobody has to wonder afterwards.
 */
export class FreezeLost extends Data.TaggedError('FreezeLost')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `the guest running ${this.appId} thawed before the bundle was finished`;
  }
}

function readLine({ wire, socketPath }: { wire: GuestWire; socketPath: string }) {
  return Effect.tryPromise({
    try: () => wire.receiveLine(),
    catch: () => new GuestSilent({ socketPath }),
  }).pipe(
    Effect.timeoutFail({
      duration: REPLY_TIMEOUT,
      onTimeout: () => new GuestSilent({ socketPath }),
    }),
  );
}

/**
 * A held freeze, for as long as the scope lives. The connection *is* the lease: dropping it is
 * what tells the guest to thaw, so an agent that dies mid-export cannot leave a tenant's
 * filesystem wedged behind it.
 */
export type FreezeLease = {
  /** Fails if the guest let go before the caller did. Ask before trusting what was read. */
  readonly assertHeld: Effect.Effect<void, FreezeLost>;
};

const NOTHING_TO_HOLD: FreezeLease = { assertHeld: Effect.void };

/**
 * A stopped app has no VMM to ask and needs none: its guest unmounted the filesystem on the way
 * down, which is the same journal checkpoint under another name. A VMM that is running and does
 * not answer is the case that must not be waved through — that is a guest whose journal still
 * holds writes the bundle would otherwise miss without saying so.
 */
export const frozen = Effect.fn('frozen')(function* ({
  appId,
  vmDir,
}: {
  appId: AppId;
  vmDir: string;
}) {
  const socketPath = guestVsockPath({ workingDir: vmWorkingDir({ vmDir, appId }) });
  const dialled = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => dialGuest({ socketPath }),
      catch: (cause) => new GuestUnreachable({ socketPath, cause }),
    }),
    (wire) => Effect.sync(() => wire.close()),
  ).pipe(Effect.option);

  if (Option.isNone(dialled)) {
    yield* Effect.logInfo('no running guest to freeze; reading the volume as it lies').pipe(
      Effect.annotateLogs({ appId, socketPath }),
    );
    return NOTHING_TO_HOLD;
  }

  const wire = dialled.value;
  wire.send(connectRequest(GUEST_CONTROL_VSOCK_PORT));
  yield* readConnectReply({
    reply: yield* readLine({ wire, socketPath }),
    port: GUEST_CONTROL_VSOCK_PORT,
  });

  wire.send(FREEZE_REQUEST);
  const reply = yield* readLine({ wire, socketPath });
  if (reply !== FREEZE_HELD) {
    return yield* new FreezeRefused({ appId, reply });
  }
  yield* Effect.logInfo('the guest froze its filesystem').pipe(Effect.annotateLogs({ appId }));

  return {
    assertHeld: Effect.suspend(() =>
      wire.isOpen() ? Effect.void : new FreezeLost({ appId }),
    ) satisfies Effect.Effect<void, FreezeLost>,
  };
});
