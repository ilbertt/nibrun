import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { CUSTOM_BUCKET_OUTPUT, setCustomBucket } from '#lib/custom-bucket.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps set-bucket', {
  description:
    'Configure an existing S3-compatible bucket for app data. The next deployment applies the setting and pauses the app while it copies existing managed data.',
  options: {
    'config-file': {
      schema: z.string().min(1),
      description:
        'Read the bucket settings as JSON from this file, or use - for stdin. Include endpoint, bucket, auth, encryptionPassword and optionally region. For access-key auth, set kind to access-key and supply accessKeyId and secretAccessKey. nibrun assigns the prefix.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
    const { interactive, emit } = createOutput({
      output: CUSTOM_BUCKET_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const app = await selectApp({ api: context.api, name: parents.apps.options.app, interactive });
    emit(await setCustomBucket({ api: context.api, appId: app.id, path: options['config-file'] }));
  },
});
