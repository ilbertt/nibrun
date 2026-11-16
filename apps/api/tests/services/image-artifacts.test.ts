import { expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { BadRequestError, ForbiddenError } from '#lib/errors.ts';
import { ImageArtifactsService } from '#services/image-artifacts.service.ts';
import { ociImage } from '#tests/support/oci-image.ts';

function service() {
  return new ImageArtifactsService({
    imagesRepo: {
      insert() {
        throw new Error('Refused image sources must not be persisted.');
      },
      findById() {
        return Promise.resolve(null);
      },
      listByApp() {
        return Promise.resolve([]);
      },
    },
  });
}

function input() {
  return {
    appId: Value.Parse(AppIdSchema, 'app'),
    ownerId: Value.Parse(OwnerIdSchema, 'owner'),
    image: ociImage(),
    isAnonymous: false,
    deploymentGrant: null,
  };
}

test('anonymous image registration is refused before persistence', async () => {
  await expect(service().create({ ...input(), isAnonymous: true })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test('deployment credentials cannot register image sources', async () => {
  await expect(
    service().create({ ...input(), deploymentGrant: { expires_at: new Date() } }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test.each([
  'localhost:5000/app',
  '127.0.0.1/app',
  'registry.internal/app',
  'docker.io.evil.test/app',
])(
  'unapproved registry hosts cannot be reached through image deployment: %s',
  async (repository) => {
    await expect(
      service().create({ ...input(), image: { ...ociImage(), repository } }),
    ).rejects.toBeInstanceOf(BadRequestError);
  },
);
