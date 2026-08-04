import { expect, test } from 'bun:test';
import { HttpClient, HttpClientResponse } from '@effect/platform';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import { AwsCredentialProvider } from '#aws/provider.ts';

const CONCURRENT_CALLERS = 4;
const TOKEN_PATH = '/latest/api/token';
const ROLE_PATH = '/latest/meta-data/iam/security-credentials/';
const SECRET = 'wJalrXUtnFEMI';

function imdsAnswer(url: string) {
  if (url.endsWith(TOKEN_PATH)) {
    return 'a-token';
  }
  return url.endsWith(ROLE_PATH)
    ? 'nibrun-host-role\n'
    : JSON.stringify({ AccessKeyId: 'AKIAEXAMPLE', SecretAccessKey: SECRET, Token: 'session' });
}

function countingImds() {
  const requested: string[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requested.push(request.url);
      return HttpClientResponse.fromWeb(request, new Response(imdsAnswer(request.url)));
    }),
  );
  return { requested, layer: Layer.succeed(HttpClient.HttpClient, client) };
}

function resolving(callers: number) {
  const imds = countingImds();
  return Effect.gen(function* () {
    const provider = yield* AwsCredentialProvider;
    const resolved = yield* Effect.all(
      Array.from({ length: callers }, () => provider.resolve),
      { concurrency: 'unbounded' },
    );
    return { resolved, requested: imds.requested };
  }).pipe(
    Effect.provide(AwsCredentialProvider.Default.pipe(Layer.provide(imds.layer))),
    // An empty provider, so a developer's own AWS_* variables cannot skip the IMDS path.
    Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
  );
}

// IMDS is rate-limited per host and the reconciler stages instances concurrently, so a cache that
// is read and written in two steps sends one round trip per caller on the first pass.
test('callers racing for credentials reach IMDS once between them', async () => {
  const { resolved, requested } = await Effect.runPromise(resolving(CONCURRENT_CALLERS));

  expect(resolved.length).toBe(CONCURRENT_CALLERS);
  expect(requested.filter((url) => url.endsWith(TOKEN_PATH)).length).toBe(1);
});

test('the secret half is readable only through Redacted, so a log line cannot carry it', async () => {
  const { resolved } = await Effect.runPromise(resolving(1));
  const credentials = resolved[0];

  expect(credentials && Redacted.value(credentials.secretAccessKey)).toBe(SECRET);
  expect(JSON.stringify(credentials)).not.toContain(SECRET);
  expect(String(credentials?.secretAccessKey)).not.toContain(SECRET);
});
