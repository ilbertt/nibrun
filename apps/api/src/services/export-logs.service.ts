import type { ExportId, HostId } from '@repo/protocol';
import { NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type { LogExportsRepositoryContract } from '#repositories/log-exports.repository.ts';
import { Service } from '#services/service.ts';

export class ExportLogsService extends Service {
  constructor(
    private readonly repositories: {
      agentRepo: Pick<AgentRepositoryContract, 'desiredState'>;
      logsRepo: LogExportsRepositoryContract;
    },
  ) {
    super();
  }

  async open({
    hostId,
    exportId,
    signal,
  }: {
    hostId: HostId;
    exportId: ExportId;
    signal: AbortSignal;
  }) {
    const desired = await this.repositories.agentRepo.desiredState({ hostId });
    const bundle = desired.exports.find(
      (candidate) => candidate.exportId === exportId && candidate.desiredState === 'present',
    );
    if (!bundle) {
      throw new NotFoundError('Export not found.');
    }
    return this.repositories.logsRepo.open({
      appId: bundle.appId,
      through: toTimestamp(new Date()),
      signal,
    });
  }
}
