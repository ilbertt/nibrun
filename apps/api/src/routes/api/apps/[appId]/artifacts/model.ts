import { ArtifactIdSchema, ArtifactSchema } from '@repo/protocol';
import { t } from 'elysia';
import { AppParamsSchema } from '#routes/api/apps/[appId]/model.ts';

// The api buffers the upload to hash it, so this bound is what a single request may cost the
// control plane's memory, not a judgement about how large a binary may be.
const MAX_ARTIFACT_SIZE = '256m';

export const ArtifactParamsSchema = t.Composite([
  AppParamsSchema,
  t.Object({ artifactId: ArtifactIdSchema }),
]);

export const CreateArtifactBodySchema = t.Object({
  binary: t.File({ maxSize: MAX_ARTIFACT_SIZE }),
});

export const ListArtifactsResponseSchema = t.Object({
  artifacts: t.Array(ArtifactSchema),
});
