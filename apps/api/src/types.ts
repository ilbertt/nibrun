import type { ApiController } from '#routes/api/controller.ts';
import type { InternalController } from '#routes/internal/controller.ts';

// Two types rather than one for the whole app, so a client can be built from a
// single surface. Nothing that types itself against the public one can name an
// internal route, which is what keeps that surface out of the browser bundle.
export type PublicApp = typeof ApiController;

export type InternalApp = typeof InternalController;
