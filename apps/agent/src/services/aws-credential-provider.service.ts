import { HttpClient } from '@effect/platform';
import { Clock, Effect, Option, SynchronizedRef } from 'effect';
import { type AwsCredentials, needsRefresh, staticCredentials } from '#lib/aws/credentials.ts';
import { fetchInstanceCredentials } from '#lib/aws/imds.ts';

export class AwsCredentialProvider extends Effect.Service<AwsCredentialProvider>()(
  'AwsCredentialProvider',
  {
    effect: Effect.gen(function* () {
      const configured = yield* staticCredentials;
      const http = yield* HttpClient.HttpClient;
      const cached = yield* SynchronizedRef.make(Option.none<AwsCredentials>());

      /** Synchronized: instances are staged concurrently, and IMDS is rate-limited per host. */
      const refreshed = SynchronizedRef.modifyEffect(cached, (current) =>
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis;
          if (Option.isSome(current) && !needsRefresh({ credentials: current.value, nowMs })) {
            return [current.value, current] as const;
          }
          const fresh = yield* Effect.provideService(
            fetchInstanceCredentials,
            HttpClient.HttpClient,
            http,
          );
          return [fresh, Option.some(fresh)] as const;
        }),
      );

      return {
        resolve: Option.match(configured, {
          onNone: () => refreshed,
          onSome: (credentials: AwsCredentials) => Effect.succeed(credentials),
        }),
      };
    }),
  },
) {}
