import { Effect } from 'effect';
import { detachVerified, reattachVerified } from '#lib/volumes/nbd.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class AppVolumeNbd extends Effect.Service<AppVolumeNbd>()('AppVolumeNbd', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    return {
      reattach: Effect.fn('AppVolumeNbd.reattach')(
        (target: Omit<Parameters<typeof reattachVerified>[0], 'client'>) =>
          reattachVerified({ ...target, client: config.appVolumeNbdClient }),
      ),
      detach: Effect.fn('AppVolumeNbd.detach')(
        (target: Omit<Parameters<typeof detachVerified>[0], 'client'>) =>
          detachVerified({ ...target, client: config.appVolumeNbdClient }),
      ),
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
