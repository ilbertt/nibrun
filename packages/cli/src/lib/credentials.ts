import { join } from 'node:path';
import { createFilesContext, osHomeConfigDir } from '@parshjs/files';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';

const CONFIG_DIR = 'nib';
const CREDENTIALS_FILE = 'credentials.json';

/**
 * The api that issued a token is stored beside it. A session is only a credential for the
 * control plane that minted it, so signing in to staging and then running against production
 * has to be answerable as such rather than arriving as an unexplained 401.
 */
const CredentialsSchema = z.object({
  apiUrl: z.url(),
  accessToken: z.string().min(1),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export function createCredentialsStore() {
  return createFilesContext({
    basePath: join(osHomeConfigDir(), CONFIG_DIR),
    files: {
      credentials: { filename: CREDENTIALS_FILE, schema: CredentialsSchema },
    },
  });
}

/**
 * The gate a command that talks to the api runs before its handler, so being signed out costs one
 * sentence rather than a request that comes back refused with nothing to do about it.
 */
export function requireSignedIn({
  credentials,
  apiUrl,
}: {
  credentials: Credentials | null;
  apiUrl: string;
}): void {
  if (!credentials) {
    throw new UsageError('Not signed in. Run `nib login`.');
  }
  if (credentials.apiUrl !== apiUrl) {
    throw new UsageError(
      `Signed in to ${credentials.apiUrl}, not ${apiUrl}. Run \`nib login\` again.`,
    );
  }
}
