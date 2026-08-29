import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { markdownResponse } from '#lib/blog-markdown.ts';
import { deployRedirect } from '#lib/deploy-redirect.ts';

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  fetch(request) {
    return deployRedirect(request) ?? markdownResponse(request) ?? startFetch(request);
  },
} satisfies ExportedHandler<Env>;
