import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { deployRedirect } from '#lib/deploy-redirect.ts';
import { markdownResponse } from '#lib/markdown-response.ts';

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  fetch(request) {
    return deployRedirect(request) ?? markdownResponse(request) ?? startFetch(request);
  },
} satisfies ExportedHandler<Env>;
