import { type Api, unwrap } from '#lib/api.ts';
import { ApiError, UsageError } from '#lib/errors.ts';

const NO_APP_NAMED = 'Which app? Name one with --app-slug.';

/**
 * `--app-slug` is optional on `apps` so that asking for nothing is answered with a listing rather
 * than an error, which leaves every command underneath to say what going without one means. They
 * all mean the same thing, so they say it from here.
 */
export function requireAppSlug(slug: string | undefined): string {
  if (slug === undefined) {
    throw new UsageError(NO_APP_NAMED);
  }
  return slug;
}

// Apps are addressed by id and listed by slug; the slug is the half a person sees, so it is the
// half the CLI takes and this is where the two meet.
export async function appBySlug({ api, slug }: { api: Api; slug: string }) {
  const { apps } = unwrap(await api.api.apps.get());
  const found = apps.find((app) => app.slug === slug);
  if (!found) {
    throw new ApiError(`No app with slug ${slug}.`);
  }
  return found;
}
