import { join } from 'node:path';
import { createEnvContext } from '@parshjs/env';
import { createFilesContext, osHomeConfigDir } from '@parshjs/files';
import { RUNTIME_VALUES } from '@repo/protocol';
import { z } from 'zod';
import { DEFAULT_API_URL, PROGRAM_NAME } from '#config.ts';
import { createApi } from '#lib/api.ts';
import { CredentialsSchema } from '#lib/credentials.ts';
import type { HostEnvironment } from '#lib/serve.ts';

const CREDENTIALS_FILENAME = 'credentials.json';

/**
 * Not a nibrun name: it is what every other host sets, and nibrun sets it beside
 * `NIBRUN_HTTP_PORT` so that a binary written for one of them needs no porting to run here.
 */
const PORT_VARIABLE = 'PORT';

const AssignedPortSchema = z.number().int().positive().nullable();

/**
 * What every handler is given. A factory rather than an object, because parsh runs one only once
 * a command is about to: reading the environment and the credential is work `--help` must not do.
 */
export async function createCliContext() {
  const env = createEnvContext({
    vars: { NIBRUN_API_URL: { schema: z.url(), default: DEFAULT_API_URL } },
  });
  const apiUrl = env.NIBRUN_API_URL;

  /**
   * What the host running this nib says about itself, for `nib serve` — the one command that is
   * the thing being hosted. `null` rather than a default wherever nothing set it, because
   * "nobody told us" is what says this is somebody's own machine, and a default would answer
   * that question instead of leaving it to be asked.
   */
  const runtime: HostEnvironment = createEnvContext({
    vars: {
      httpPort: {
        name: RUNTIME_VALUES.HTTP_PORT.name,
        schema: AssignedPortSchema,
        default: null,
      },
      port: { name: PORT_VARIABLE, schema: AssignedPortSchema, default: null },
      hostname: {
        name: RUNTIME_VALUES.HOSTNAME.name,
        schema: z.string().min(1).nullable(),
        default: null,
      },
    },
  });

  const files = createFilesContext({
    basePath: join(osHomeConfigDir(), PROGRAM_NAME),
    files: {
      credentials: { filename: CREDENTIALS_FILENAME, schema: CredentialsSchema },
    },
  });

  const credentials = await files.credentials.maybeRead();
  const api = createApi({ baseUrl: apiUrl, credentials });

  return { apiUrl, files, api, runtime };
}
