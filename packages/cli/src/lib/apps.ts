import { type Api, unwrap } from '#lib/api.ts';
import { ApiError } from '#lib/errors.ts';

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
