import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { markdownResponse } from '#lib/blog-markdown.ts';

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  fetch(request) {
    return markdownResponse(request) ?? startFetch(request);
  },
} satisfies ExportedHandler<Env>;
