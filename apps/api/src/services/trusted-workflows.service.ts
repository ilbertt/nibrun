import type { AppId } from '@repo/protocol';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { TrustedWorkflow } from '#lib/api/trusted-workflow.ts';
import { NotFoundError } from '#lib/errors.ts';
import type { TrustedWorkflowsRepositoryContract } from '#repositories/trusted-workflows.repository.ts';
import { Service } from '#services/service.ts';

type OwnedApp = { appId: AppId; ownerId: OwnerId };

export class TrustedWorkflowsService extends Service {
  private readonly workflowsRepo: TrustedWorkflowsRepositoryContract;

  constructor({ workflowsRepo }: { workflowsRepo: TrustedWorkflowsRepositoryContract }) {
    super();
    this.workflowsRepo = workflowsRepo;
  }

  async find(input: OwnedApp): Promise<TrustedWorkflow> {
    const workflow = await this.workflowsRepo.find(input);
    if (!workflow) {
      throw new NotFoundError('Trusted workflow not found.');
    }
    return workflow;
  }

  async save({
    appId,
    ownerId,
    workflow,
  }: OwnedApp & { workflow: TrustedWorkflow }): Promise<TrustedWorkflow> {
    const saved = await this.workflowsRepo.save({
      appId,
      ownerId,
      workflow: { ...workflow, repository: workflow.repository.toLowerCase() },
    });
    if (!saved) {
      throw new NotFoundError('App not found.');
    }
    return saved;
  }

  async remove(input: OwnedApp): Promise<void> {
    if (!(await this.workflowsRepo.remove(input))) {
      throw new NotFoundError('Trusted workflow not found.');
    }
  }
}
