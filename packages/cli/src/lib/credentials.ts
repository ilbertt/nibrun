import type { FileHandle } from '@parshjs/files';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';

/**
 * The api that issued a token is stored beside it. A session is only a credential for the
 * control plane that minted it, so signing in to staging and then running against production
 * has to be answerable as such rather than arriving as an unexplained 401.
 */
export const CredentialsSchema = z.object({
  apiUrl: z.url(),
  accessToken: z.string().min(1),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

// Only the one thing the gate does with the store, so what it asks for is what it uses.
type CredentialsStore = { credentials: Pick<FileHandle<Credentials>, 'maybeRead'> };

/**
 * The gate a command that talks to the api runs before its handler, so being signed out costs one
 * sentence rather than a request that comes back refused with nothing to do about it.
 *
 * Read here rather than taken from the context, so it is the credential on disk now being
 * checked — a run that signs in first would otherwise be gated on what was there before it did.
 */
export async function requireSignedIn({
  files,
  apiUrl,
}: {
  files: CredentialsStore;
  apiUrl: string;
}): Promise<void> {
  const credentials = await files.credentials.maybeRead();

  if (!credentials) {
    throw new UsageError('Not signed in. Run `nib login`.');
  }
  if (credentials.apiUrl !== apiUrl) {
    throw new UsageError(
      `Signed in to ${credentials.apiUrl}, not ${apiUrl}. Run \`nib login\` again.`,
    );
  }
}
