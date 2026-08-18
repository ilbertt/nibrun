import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  fetch(request) {
    return startFetch(request);
  },
} satisfies ExportedHandler<Env>;
