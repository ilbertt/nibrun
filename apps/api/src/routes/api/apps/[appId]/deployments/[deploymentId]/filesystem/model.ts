import { GuestPathSchema } from '@repo/protocol';
import { t } from 'elysia';

/**
 * Which directory, defaulted at the handler rather than here: the volume's root is the one path
 * that is always meaningful, and a browser opening a filesystem has no other place to start.
 */
export const ReadDirectoryQuerySchema = t.Object({
  path: t.Optional(GuestPathSchema),
});
