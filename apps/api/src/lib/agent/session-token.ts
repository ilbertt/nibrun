import { UnauthorizedError } from '#lib/errors.ts';

const BEARER_PREFIX = 'Bearer ';

/**
 * The session is the host's identity: desired state carries no host id, so what a host is told
 * about is decided here and nowhere else.
 */
export function sessionTokenFrom(headers: Record<string, string | undefined>): string {
  const authorization = headers.authorization;
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Missing session.');
  }
  return authorization.slice(BEARER_PREFIX.length);
}
