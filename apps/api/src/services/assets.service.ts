import { extname } from 'node:path';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import type { AssetsRepository } from '#repositories/assets.repository.ts';
import { Service } from '#services/service.ts';

type AssetsRepositoryContract = Pick<AssetsRepository, 'list'>;

const INDEX_HTML_PATH = '/index.html';
// Vite content-hashes the filenames in this folder, so they never change.
const IMMUTABLE_PATH_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

export class AssetsService extends Service {
  private readonly assetsRepo: AssetsRepositoryContract;

  constructor(assetsRepo: AssetsRepositoryContract) {
    super();
    this.assetsRepo = assetsRepo;
  }

  routes(): Map<string, Response> {
    const assets = this.assetsRepo.list();
    const routes = new Map<string, Response>();

    for (const [path, asset] of assets) {
      routes.set(path, this.respond({ asset, path }));
    }

    const indexHtml = assets.get(INDEX_HTML_PATH);
    if (indexHtml) {
      routes.set(RoutePrefix.Root, this.respond({ asset: indexHtml, path: INDEX_HTML_PATH }));
    }

    this.logger.info(`Serving ${routes.size} dashboard routes`);
    return routes;
  }

  fallback(request: Request): Response | null {
    const path = new URL(request.url).pathname;
    const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? false;
    const readsPage = request.method === 'GET' || request.method === 'HEAD';
    if (!readsPage || !acceptsHtml || extname(path) !== '') {
      return null;
    }

    const indexHtml = this.assetsRepo.list().get(INDEX_HTML_PATH);
    return indexHtml ? this.respond({ asset: indexHtml, path: INDEX_HTML_PATH }) : null;
  }

  private respond({ asset, path }: { asset: Blob; path: string }): Response {
    const cacheControl = path.startsWith(IMMUTABLE_PATH_PREFIX)
      ? IMMUTABLE_CACHE_CONTROL
      : REVALIDATE_CACHE_CONTROL;

    return new Response(asset, {
      headers: { 'Cache-Control': cacheControl },
    });
  }
}
