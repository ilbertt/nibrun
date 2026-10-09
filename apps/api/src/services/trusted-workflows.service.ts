import { schema } from '#db/queries.gen.ts';
import type { TrustedWorkflow, TrustedWorkflowResource } from '#lib/api/trusted-workflow.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import type {
  CreateTrustedWorkflowInput,
  TrustedWorkflowByIdInput,
  TrustedWorkflowsByAppInput,
  TrustedWorkflowsRepositoryContract,
  UpdateTrustedWorkflowInput,
} from '#repositories/trusted-workflows.repository.ts';
import { Service } from '#services/service.ts';

const APP_WORKFLOW_CONSTRAINT =
  schema.github_trusted_deployment_workflows._constraints
    .github_trusted_deployment_workflows_app_id_key._constraintName;

export class TrustedWorkflowsService extends Service {
  private readonly workflowsRepo: TrustedWorkflowsRepositoryContract;

  constructor({ workflowsRepo }: { workflowsRepo: TrustedWorkflowsRepositoryContract }) {
    super();
    this.workflowsRepo = workflowsRepo;
  }

  async find(input: TrustedWorkflowsByAppInput): Promise<TrustedWorkflowResource> {
    const workflow = await this.workflowsRepo.find(input);
    if (!workflow) {
      throw new NotFoundError('Trusted workflow not found.');
    }
    return workflow;
  }

  async create({
    workflow,
    ...input
  }: CreateTrustedWorkflowInput): Promise<TrustedWorkflowResource> {
    try {
      const created = await this.workflowsRepo.create({
        ...input,
        workflow: this.normalizeWorkflow(workflow),
      });
      if (!created) {
        throw new NotFoundError('App not found.');
      }
      return created;
    } catch (error) {
      if (isUniqueViolation({ error, constraint: APP_WORKFLOW_CONSTRAINT })) {
        throw new ConflictError('This app already has a trusted workflow.');
      }
      throw error;
    }
  }

  async update({
    workflow,
    ...input
  }: UpdateTrustedWorkflowInput): Promise<TrustedWorkflowResource> {
    const updated = await this.workflowsRepo.update({
      ...input,
      workflow: this.normalizeWorkflow(workflow),
    });
    if (!updated) {
      throw new NotFoundError('Trusted workflow not found.');
    }
    return updated;
  }

  async remove(input: TrustedWorkflowByIdInput): Promise<void> {
    if (!(await this.workflowsRepo.remove(input))) {
      throw new NotFoundError('Trusted workflow not found.');
    }
  }

  private normalizeWorkflow(workflow: TrustedWorkflow): TrustedWorkflow {
    return { ...workflow, repository: workflow.repository.toLowerCase() };
  }
}
