import { AppIdSchema } from '@repo/protocol';
import { t } from 'elysia';

export const AppParamsSchema = t.Object({ appId: AppIdSchema });
