import { expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { NotFoundError } from '#lib/errors.ts';
import type {
  SaveTrustedWorkflowInput,
  TrustedWorkflowRow,
  TrustedWorkflowsRepositoryContract,
} from '#repositories/trusted-workflows.repository.ts';
import { TrustedWorkflowsService } from '#services/trusted-workflows.service.ts';
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

const OWNED_APP = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  ownerId: Value.Parse(OwnerIdSchema, 'owner-1'),
};
type OwnedApp = typeof OWNED_APP;

class StubWorkflowsRepository implements TrustedWorkflowsRepositoryContract {
  readonly calls: OwnedApp[] = [];
  row: TrustedWorkflowRow | null = null;
  writable = true;

  find(input: OwnedApp): Promise<TrustedWorkflowRow | null> {
    this.calls.push(input);
    return Promise.resolve(this.row);
  }

  save({ workflow, ...input }: SaveTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    this.calls.push(input);
    if (this.writable) {
      this.row = workflow;
    }
    return Promise.resolve(this.writable ? this.row : null);
  }

  remove(input: OwnedApp): Promise<boolean> {
    this.calls.push(input);
    const found = this.row !== null;
    this.row = null;
    return Promise.resolve(found);
  }
}

function build() {
  const workflowsRepo = new StubWorkflowsRepository();
  return { workflowsRepo, service: new TrustedWorkflowsService({ workflowsRepo }) };
}

test('save replaces the configuration and normalizes repository casing', async () => {
  const { service } = build();
  expect(
    await service.save({ ...OWNED_APP, workflow: trustedWorkflow({ repository: 'ACME/Backend' }) }),
  ).toEqual(trustedWorkflow());
  const replacement = trustedWorkflow({
    workflow: 'release.yaml',
    branch: 'production',
    environment: 'production',
  });
  expect(await service.save({ ...OWNED_APP, workflow: replacement })).toEqual(replacement);
  expect(await service.find(OWNED_APP)).toEqual(replacement);
});

test('every service operation passes the owner and app to persistence', async () => {
  const { workflowsRepo, service } = build();
  await service.save({ ...OWNED_APP, workflow: trustedWorkflow() });
  await service.find(OWNED_APP);
  await service.remove(OWNED_APP);
  expect(workflowsRepo.calls).toEqual([OWNED_APP, OWNED_APP, OWNED_APP]);
  await expect(service.find(OWNED_APP)).rejects.toBeInstanceOf(NotFoundError);
});

test('missing and inaccessible apps or configurations return not found', async () => {
  const { workflowsRepo, service } = build();
  workflowsRepo.writable = false;
  await expect(service.save({ ...OWNED_APP, workflow: trustedWorkflow() })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(service.find(OWNED_APP)).rejects.toBeInstanceOf(NotFoundError);
  await expect(service.remove(OWNED_APP)).rejects.toBeInstanceOf(NotFoundError);
});
