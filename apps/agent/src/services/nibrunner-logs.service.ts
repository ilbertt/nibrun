import { Effect } from 'effect';
import { makeLogStoreClient } from '#lib/logs/store-client.ts';
import { makeNibrunnerLogDelivery } from '#lib/nibrunner/log-delivery.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';
import { NibrunnerLogCursors } from '#services/nibrunner-log-cursors.service.ts';

export class NibrunnerLogs extends Effect.Service<NibrunnerLogs>()('NibrunnerLogs', {
  scoped: Effect.gen(function* () {
    const config = yield* NibrunnerBridgeConfig;
    const cursors = yield* NibrunnerLogCursors;
    return yield* makeNibrunnerLogDelivery({
      directory: config.logsDirectory,
      store: makeLogStoreClient({ baseUrl: config.logIngestUrl }),
      cursors,
    });
  }),
  dependencies: [NibrunnerBridgeConfig.Default, NibrunnerLogCursors.Default],
}) {}
