import { HttpClient } from '@effect/platform';
import { Clock, Effect, Option, Ref } from 'effect';
import { type AwsCredentials, needsRefresh, staticCredentials } from '#aws/credentials.ts';
import { fetchInstanceCredentials } from '#aws/imds.ts';

export class AwsCredentialProvider extends Effect.Service<AwsCredentialProvider>()(
  'AwsCredentialProvider',
  {
    effect: Effect.gen(function* () {
      const configured = yield* staticCredentials;
      const http = yield* HttpClient.HttpClient;
      const cached = yield* Ref.make(Option.none<AwsCredentials>());

      const refreshed = Effect.gen(function* () {
        const current = yield* Ref.get(cached);
        const nowMs = yield* Clock.currentTimeMillis;
        if (Option.isSome(current) && !needsRefresh({ credentials: current.value, nowMs })) {
          return current.value;
        }
        const fresh = yield* Effect.provideService(
          fetchInstanceCredentials,
          HttpClient.HttpClient,
          http,
        );
        yield* Ref.set(cached, Option.some(fresh));
        return fresh;
      });

      return {
        resolve: Option.match(configured, {
          onNone: () => refreshed,
          onSome: (credentials: AwsCredentials) => Effect.succeed(credentials),
        }),
      };
    }),
  },
) {}
