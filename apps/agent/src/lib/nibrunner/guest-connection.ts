import { type ClientRequest, request } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AppId, DeploymentId } from '@repo/protocol';
import { Data, Effect } from 'effect';

const CONNECT_TIMEOUT = '15 seconds';
const CONNECTED = 200;
const MAX_HEADER_BYTES = 4096;

export class NibrunnerGuestUnavailable extends Data.TaggedError('NibrunnerGuestUnavailable') {
  override get message() {
    return 'The current nibrunner guest service could not be reached.';
  }
}

export function connectNibrunnerGuest({
  socketPath,
  appId,
  deploymentId,
  port,
}: {
  socketPath: string;
  appId: AppId;
  deploymentId: DeploymentId;
  port: number;
}) {
  return Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(
      Effect.sync((): { pending: ClientRequest; stream: Duplex | undefined } => ({
        pending: request({
          socketPath,
          method: 'CONNECT',
          path: `${appId}:${port}`,
          headers: { host: 'localhost', 'if-match': `"${deploymentId}"` },
          agent: false,
          maxHeaderSize: MAX_HEADER_BYTES,
        }),
        stream: undefined,
      })),
      ({ pending, stream }) =>
        Effect.sync(() => {
          pending.destroy();
          stream?.destroy();
        }),
    );
    const { pending } = connection;
    const connect = Effect.async<Duplex, NibrunnerGuestUnavailable>((resume) => {
      let settled = false;
      function failed() {
        if (settled) {
          return;
        }
        settled = true;
        pending.destroy();
        connection.stream?.destroy();
        resume(Effect.fail(new NibrunnerGuestUnavailable()));
      }
      // biome-ignore lint/complexity/useMaxParams: Node supplies the response, stream and buffered bytes.
      pending.once('connect', (response, connected, head) => {
        connection.stream = connected;
        if (settled || response.statusCode !== CONNECTED) {
          connected.destroy();
          failed();
          return;
        }
        settled = true;
        connected.pause();
        connected.on('error', () => connected.destroy());
        if (head.length > 0) {
          connected.unshift(head);
        }
        resume(Effect.succeed(connected));
      });
      pending.once('response', (response) => {
        response.resume();
        failed();
      });
      pending.on('error', failed);
      pending.end();
      return Effect.sync(() => {
        settled = true;
        pending.destroy();
        connection.stream?.destroy();
      });
    }).pipe(
      Effect.timeoutFail({
        duration: CONNECT_TIMEOUT,
        onTimeout: () => new NibrunnerGuestUnavailable(),
      }),
    );
    return yield* connect;
  });
}
