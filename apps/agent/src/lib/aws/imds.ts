import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from '@effect/platform';
import { type Duration, Effect } from 'effect';
import { InstanceCredentialsError, parseCredentialsDocument } from '#lib/aws/credentials.ts';
import { describe } from '#lib/failure.ts';

export const IMDS_BASE_URL = 'http://169.254.169.254';
const TOKEN_PATH = '/latest/api/token';
const ROLE_PATH = '/latest/meta-data/iam/security-credentials/';
const TOKEN_TTL_HEADER = 'x-aws-ec2-metadata-token-ttl-seconds';
const TOKEN_HEADER = 'x-aws-ec2-metadata-token';
const TOKEN_TTL_SECONDS = 21_600;
const REQUEST_TIMEOUT: Duration.DurationInput = '5 seconds';

/**
 * IMDSv2 by hand, because Bun's S3 client resolves static credentials only. v2 rather than v1:
 * the session-token handshake is what makes a request forgeable only from on the host.
 */
export const fetchInstanceCredentials = Effect.gen(function* () {
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

  const send = <A>({
    request,
    read,
  }: {
    request: HttpClientRequest.HttpClientRequest;
    read: (
      response: HttpClientResponse.HttpClientResponse,
    ) => Effect.Effect<A, HttpClientError.ResponseError>;
  }) =>
    Effect.scoped(Effect.flatMap(http.execute(request), read)).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
    );

  const token = yield* send({
    request: HttpClientRequest.put(`${IMDS_BASE_URL}${TOKEN_PATH}`, {
      headers: { [TOKEN_TTL_HEADER]: String(TOKEN_TTL_SECONDS) },
    }),
    read: (response) => response.text,
  });

  const authorized = (path: string) =>
    HttpClientRequest.get(`${IMDS_BASE_URL}${path}`, { headers: { [TOKEN_HEADER]: token } });

  const roles = yield* send({ request: authorized(ROLE_PATH), read: (response) => response.text });
  const roleName = roles.trim().split('\n')[0]?.trim();
  if (!roleName) {
    return yield* new InstanceCredentialsError({ detail: 'no role is attached to this instance' });
  }

  const document = yield* send({
    request: authorized(`${ROLE_PATH}${roleName}`),
    read: (response) => response.json,
  });
  return yield* parseCredentialsDocument(document);
}).pipe(
  // Named rather than caught by class, so a new way for the request to fail is a compile error
  // here instead of a `String(cause)` nobody chose.
  Effect.catchTags({
    RequestError: (cause) => new InstanceCredentialsError({ detail: describe(cause) }),
    ResponseError: (cause) => new InstanceCredentialsError({ detail: describe(cause) }),
    TimeoutException: () =>
      new InstanceCredentialsError({ detail: 'the metadata endpoint did not answer in time' }),
  }),
);
