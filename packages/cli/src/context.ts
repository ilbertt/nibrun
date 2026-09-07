import { join } from 'node:path';
import { createEnvContext } from '@parshjs/env';
import { createFilesContext, osHomeConfigDir } from '@parshjs/files';
import { z } from 'zod';
import { DEFAULT_API_URL, PROGRAM_NAME } from '#config.ts';
import { createApi } from '#lib/api.ts';
import { CredentialsSchema } from '#lib/credentials.ts';

const CREDENTIALS_FILENAME = 'credentials.json';

/**
 * What every handler is given. A factory rather than an object, because parsh runs one only once
 * a command is about to: reading the environment and the credential is work `--help` must not do.
 */
export async function createCliContext() {
  const env = createEnvContext({
    vars: { NIBRUN_API_URL: { schema: z.url(), default: DEFAULT_API_URL } },
  });
  const apiUrl = env.NIBRUN_API_URL;

  const files = createFilesContext({
    basePath: join(osHomeConfigDir(), PROGRAM_NAME),
    files: {
      credentials: { filename: CREDENTIALS_FILENAME, schema: CredentialsSchema },
    },
  });

  const credentials = await files.credentials.maybeRead();
  const api = createApi({ baseUrl: apiUrl, credentials });

  return { apiUrl, files, api };
}
