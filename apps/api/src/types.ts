import type { ApiController } from '#routes/api/controller.ts';
import type { InternalController } from '#routes/internal/controller.ts';

export type PublicApp = typeof ApiController;

export type InternalApp = typeof InternalController;
