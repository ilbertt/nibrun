import { expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema, TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import { NotFoundError } from '#lib/errors.ts';
import type {
  CreateTrustedWorkflowInput,
  TrustedWorkflowByIdInput,
  TrustedWorkflowRow,
  TrustedWorkflowsByAppInput,
  TrustedWorkflowsRepositoryContract,
  UpdateTrustedWorkflowInput,
} from '#repositories/trusted-workflows.repository.ts';
import { TrustedWorkflowsService } from '#services/trusted-workflows.service.ts';
import { trustedWorkflow, trustedWorkflowResource } from '#tests/support/trusted-workflows.ts';

const OWNED_APP = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  ownerId: Value.Parse(OwnerIdSchema, 'owner-1'),
};
const OWNED_WORKFLOW = { ...OWNED_APP, workflowId: trustedWorkflowResource().id };

class StubWorkflowsRepository implements TrustedWorkflowsRepositoryContract {
  readonly calls: (TrustedWorkflowsByAppInput | TrustedWorkflowByIdInput)[] = [];
  row: TrustedWorkflowRow | null = null;
  writable = true;

  find(input: TrustedWorkflowsByAppInput): Promise<TrustedWorkflowRow | null> {
    this.calls.push(input);
    return Promise.resolve(this.row);
  }

  create({ workflow, ...input }: CreateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    this.calls.push(input);
    if (!this.writable) {
      return Promise.resolve(null);
    }
    this.row = trustedWorkflowResource(workflow);
    return Promise.resolve(this.row);
  }

  update({ workflow, ...input }: UpdateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    this.calls.push(input);
    if (!this.writable || this.row?.id !== input.workflowId) {
      return Promise.resolve(null);
    }
    this.row = { id: input.workflowId, ...workflow };
    return Promise.resolve(this.row);
  }

  remove(input: TrustedWorkflowByIdInput): Promise<boolean> {
    this.calls.push(input);
    if (this.row?.id !== input.workflowId) {
      return Promise.resolve(false);
    }
    this.row = null;
    return Promise.resolve(true);
  }
}

function build() {
  const workflowsRepo = new StubWorkflowsRepository();
  return { workflowsRepo, service: new TrustedWorkflowsService({ workflowsRepo }) };
}

test('creation and replacement normalize repository casing and preserve the resource ID', async () => {
  const { service } = build();
  const created = await service.create({
    ...OWNED_APP,
    workflow: trustedWorkflow({ repository: 'ACME/Backend' }),
  });
  expect(created).toEqual(trustedWorkflowResource());
  const replacement = trustedWorkflow({
    repository: 'ACME/Release',
    workflow: 'release.yaml',
    branch: 'production',
    environment: 'production',
  });
  const expected = { id: created.id, ...replacement, repository: 'acme/release' };
  expect(await service.update({ ...OWNED_WORKFLOW, workflow: replacement })).toEqual(expected);
  expect(await service.find(OWNED_APP)).toEqual(expected);
});

test('every service operation passes the owner, app, and relevant resource ID to persistence', async () => {
  const { workflowsRepo, service } = build();
  await service.create({ ...OWNED_APP, workflow: trustedWorkflow() });
  await service.find(OWNED_APP);
  await service.update({ ...OWNED_WORKFLOW, workflow: trustedWorkflow() });
  await service.remove(OWNED_WORKFLOW);
  expect(workflowsRepo.calls).toEqual([OWNED_APP, OWNED_APP, OWNED_WORKFLOW, OWNED_WORKFLOW]);
  await expect(service.find(OWNED_APP)).rejects.toBeInstanceOf(NotFoundError);
});

test('updates and removal never create or address a different workflow', async () => {
  const { service } = build();
  await expect(
    service.update({ ...OWNED_WORKFLOW, workflow: trustedWorkflow() }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await service.create({ ...OWNED_APP, workflow: trustedWorkflow() });
  const wrongWorkflow = {
    ...OWNED_APP,
    workflowId: Value.Parse(TrustedWorkflowIdSchema, 'other-workflow'),
  };
  await expect(
    service.update({ ...wrongWorkflow, workflow: trustedWorkflow({ branch: 'other' }) }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(service.remove(wrongWorkflow)).rejects.toBeInstanceOf(NotFoundError);
  expect(await service.find(OWNED_APP)).toEqual(trustedWorkflowResource());
});

test('missing and inaccessible apps or configurations return not found', async () => {
  const { workflowsRepo, service } = build();
  workflowsRepo.writable = false;
  await expect(
    service.create({ ...OWNED_APP, workflow: trustedWorkflow() }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(service.find(OWNED_APP)).rejects.toBeInstanceOf(NotFoundError);
  await expect(
    service.update({ ...OWNED_WORKFLOW, workflow: trustedWorkflow() }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(service.remove(OWNED_WORKFLOW)).rejects.toBeInstanceOf(NotFoundError);
});
