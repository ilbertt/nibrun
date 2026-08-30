import { z } from 'zod';

/**
 * An export, whether it was just asked for or is being checked on. One shape for both, because
 * what a caller wants of either is the same question — is there a url yet.
 */
export const ExportResultSchema = z.object({
  exportId: z.string(),
  state: z.string(),
  downloadUrl: z.string().optional(),
  sizeBytes: z.number().optional(),
  detail: z.string(),
});
