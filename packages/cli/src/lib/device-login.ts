import { z } from 'zod';
import { ApiError, UsageError } from '#lib/errors.ts';

const DEVICE_CODE_PATH = '/api/auth/device/code';
const DEVICE_TOKEN_PATH = '/api/auth/device/token';

// Sent so the record of a pending login says what asked for it. Not a secret and not a
// credential: a public client has nothing to prove, which is the whole reason this flow exists.
const CLIENT_ID = 'nib-cli';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

const MS_PER_SECOND = 1_000;
// What the endpoint asks for when it wants to be polled less often. RFC 8628 leaves the amount
// to the client and this is the interval it suggests starting from.
const SLOW_DOWN_SECONDS = 5;

const StartedSchema = z.object({
  user_code: z.string(),
  device_code: z.string(),
  verification_uri_complete: z.url(),
  expires_in: z.number(),
  interval: z.number(),
});

export type StartedLogin = z.infer<typeof StartedSchema>;

const GrantedSchema = z.object({ access_token: z.string().min(1) });

const RefusedSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

/** Asks for a code to show, and for the address the owner approves it at. */
export async function startLogin({ apiUrl }: { apiUrl: string }): Promise<StartedLogin> {
  const response = await post({
    url: `${apiUrl}${DEVICE_CODE_PATH}`,
    body: { client_id: CLIENT_ID },
  });
  if (!response.ok) {
    throw new ApiError(`Could not start a login at ${apiUrl}: ${refusal(response.body)}`);
  }
  return StartedSchema.parse(response.body);
}

/**
 * Polls until the owner answers, which is the only thing that ends this — the endpoint says
 * `authorization_pending` for as long as nobody has, and each of the other answers is final.
 */
export async function awaitApproval({
  apiUrl,
  started,
}: {
  apiUrl: string;
  started: StartedLogin;
}): Promise<string> {
  const deadline = Date.now() + started.expires_in * MS_PER_SECOND;
  let waitMs = started.interval * MS_PER_SECOND;

  while (Date.now() < deadline) {
    await Bun.sleep(waitMs);
    const response = await post({
      url: `${apiUrl}${DEVICE_TOKEN_PATH}`,
      body: { grant_type: GRANT_TYPE, device_code: started.device_code, client_id: CLIENT_ID },
    });
    if (response.ok) {
      return GrantedSchema.parse(response.body).access_token;
    }

    const refused = RefusedSchema.safeParse(response.body);
    switch (refused.data?.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        waitMs += SLOW_DOWN_SECONDS * MS_PER_SECOND;
        break;
      case 'access_denied':
        throw new UsageError('That request was refused.');
      case 'expired_token':
        throw new UsageError('That code expired. Run `nib login` again.');
      default:
        throw new ApiError(refusal(response.body));
    }
  }

  throw new UsageError('That code expired. Run `nib login` again.');
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

async function post({
  url,
  body,
}: {
  url: string;
  body: Record<string, string>;
}): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new ApiError(`Could not reach ${url}: ${String(cause)}`);
  });
  return { ok: response.ok, body: await response.json().catch(() => null) };
}

function refusal(body: unknown): string {
  const refused = RefusedSchema.safeParse(body);
  if (!refused.success) {
    return 'the api gave no reason.';
  }
  return refused.data.error_description ?? refused.data.error;
}
