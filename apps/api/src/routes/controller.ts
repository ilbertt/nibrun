import { Elysia } from 'elysia';
import { NotFoundError } from '#lib/errors.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AssetsServicePlugin } from '#services/plugins.ts';

function createRootController() {
  const controller = new Elysia().use(AssetsServicePlugin);
  const { assetsService } = controller.decorator;

  for (const [path, response] of assetsService.routes()) {
    controller.get(path, response);
  }

  // A mount, not a `*` route: a wildcard route is greedy within its method and
  // would shadow anything else answering that method — a `GET *` here swallows
  // every GET a sibling controller binds to a wildcard of its own. A mount runs
  // only once no other route has matched, which is what a fallback means.
  controller.mount((request) => {
    const { pathname } = new URL(request.url);
    const response = isClientRoutePath(pathname) ? assetsService.fallback(pathname) : null;
    if (!response) {
      throw new NotFoundError();
    }

    return response;
  });

  return controller;
}

// Every prefix the server answers. A path missing from here falls through to the
// dashboard's index, so an agent calling a route that does not exist would be
// handed HTML and a 200 instead of the 404 that would tell it what is wrong.
const SERVED_PREFIXES = [RoutePrefix.Api, RoutePrefix.Internal, RoutePrefix.Mcp];

function isClientRoutePath(pathname: string): boolean {
  return !SERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const RootController = createRootController();
