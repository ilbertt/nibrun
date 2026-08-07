import { ApiError } from '@repo/api-client/unwrap';
import { createAuthClient } from 'better-auth/client';
import { deviceAuthorizationClient } from 'better-auth/client/plugins';
import { UsageError } from '#lib/errors.ts';

// Sent so the record of a pending login says what asked for it. Not a secret and not a
// credential: a public client has nothing to prove, which is the whole reason this flow exists.
const CLIENT_ID = 'nib-cli';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

const MS_PER_SECOND = 1_000;
// What the endpoint asks for when it wants to be polled less often. RFC 8628 leaves the amount
// to the client and this is the interval it suggests starting from.
const SLOW_DOWN_SECONDS = 5;

const EXPIRED = 'That code expired. Run `nib login` again.';

type DeviceClient = ReturnType<typeof createDeviceClient>;
type StartedLogin = NonNullable<Awaited<ReturnType<DeviceClient['device']['code']>>['data']>;

function createDeviceClient(apiUrl: string) {
  return createAuthClient({ baseURL: apiUrl, plugins: [deviceAuthorizationClient()] });
}

/**
 * Asks for a code to show and the address it is approved at, and hands back the wait for that
 * approval rather than what it would take to reconstruct it — the client and the code the poll
 * needs are already here, and nothing outside has any use for either.
 */
export async function startLogin({ apiUrl }: { apiUrl: string }) {
  const client = createDeviceClient(apiUrl);
  const { data, error } = await client.device.code({ client_id: CLIENT_ID });
  if (!data) {
    throw new ApiError(`Could not start a login at ${apiUrl}: ${error.error_description}`);
  }

  return {
    userCode: data.user_code,
    verificationUrl: data.verification_uri_complete,
    awaitApproval: () => awaitApproval({ client, started: data }),
  };
}

/**
 * Polls until the owner answers, which is the only thing that ends this — the endpoint says
 * `authorization_pending` for as long as nobody has, and each of the other answers is final.
 */
async function awaitApproval({
  client,
  started,
}: {
  client: DeviceClient;
  started: StartedLogin;
}): Promise<string> {
  const deadline = Date.now() + started.expires_in * MS_PER_SECOND;
  let waitMs = started.interval * MS_PER_SECOND;

  while (Date.now() < deadline) {
    await Bun.sleep(waitMs);
    const { data, error } = await client.device.token({
      grant_type: GRANT_TYPE,
      device_code: started.device_code,
      client_id: CLIENT_ID,
    });
    if (data) {
      return data.access_token;
    }

    switch (error.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        waitMs += SLOW_DOWN_SECONDS * MS_PER_SECOND;
        break;
      case 'access_denied':
        throw new UsageError('That request was refused.');
      case 'expired_token':
        throw new UsageError(EXPIRED);
      default:
        throw new ApiError(error.error_description);
    }
  }

  throw new UsageError(EXPIRED);
}

/**
 * Best effort, and never fatal: the address is printed either way, and a machine with nothing to
 * open it with is exactly the machine this flow exists for.
 */
export function openInBrowser(url: string): void {
  const opener = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[
    String(process.platform)
  ] ?? ['xdg-open'];
  try {
    Bun.spawn([...opener, url], { stdout: 'ignore', stderr: 'ignore' }).unref();
  } catch {
    // Nothing to fall back to, and nothing lost — the URL is on screen.
  }
}
