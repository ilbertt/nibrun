import { Effect } from 'effect';
import { makeSessionHolder } from '#lib/control/session.ts';
import { readHostCapacity } from '#lib/report/capacity.ts';
import { readHostVersions } from '#lib/report/versions.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';

export class AgentSessionHolder extends Effect.Service<AgentSessionHolder>()('AgentSessionHolder', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const versions = yield* readHostVersions(config.versionsFile);
    return yield* makeSessionHolder({
      control: yield* ControlPlane,
      hostIdFile: config.hostIdFile,
      versions,
      capacity: readHostCapacity({
        stateDir: config.stateDir,
        zerofsConfigFile: config.zerofsConfigFile,
      }),
    });
  }),
  dependencies: [AgentConfig.Default, ControlPlane.Default],
}) {}
