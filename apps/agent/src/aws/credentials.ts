import { Config, Data, Either, Option } from 'effect';

/** The credential has to outlive the S3 transfer it is handed to, and an artifact can be large. */
const REFRESH_MARGIN_MS = 300_000;

export type AwsCredentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiresAtMs?: number;
};

export class InstanceCredentialsError extends Data.TaggedError('InstanceCredentialsError')<{
  readonly detail: string;
}> {}

/** Absent unless both halves of the pair are set, since half a pair is not credentials. */
export const staticCredentials = Config.all({
  accessKeyId: Config.string('AWS_ACCESS_KEY_ID'),
  secretAccessKey: Config.string('AWS_SECRET_ACCESS_KEY'),
  sessionToken: Config.option(Config.string('AWS_SESSION_TOKEN')),
}).pipe(
  Config.map(
    ({ accessKeyId, secretAccessKey, sessionToken }): AwsCredentials => ({
      accessKeyId,
      secretAccessKey,
      ...Option.match(sessionToken, {
        onNone: () => ({}),
        onSome: (value) => ({ sessionToken: value }),
      }),
    }),
  ),
  Config.option,
);

export function needsRefresh({
  credentials,
  nowMs,
  marginMs = REFRESH_MARGIN_MS,
}: {
  credentials: AwsCredentials;
  nowMs: number;
  marginMs?: number;
}): boolean {
  return credentials.expiresAtMs === undefined
    ? false
    : credentials.expiresAtMs - marginMs <= nowMs;
}

export function parseCredentialsDocument(
  value: unknown,
): Either.Either<AwsCredentials, InstanceCredentialsError> {
  const document = value as Record<string, unknown> | null;
  const accessKeyId = document?.AccessKeyId;
  const secretAccessKey = document?.SecretAccessKey;
  if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
    return Either.left(new InstanceCredentialsError({ detail: 'response carried no key pair' }));
  }
  const sessionToken = document?.Token;
  const expiration = document?.Expiration;
  const expiresAtMs = typeof expiration === 'string' ? Date.parse(expiration) : Number.NaN;
  return Either.right({
    accessKeyId,
    secretAccessKey,
    ...(typeof sessionToken === 'string' ? { sessionToken } : {}),
    ...(Number.isFinite(expiresAtMs) ? { expiresAtMs } : {}),
  });
}
