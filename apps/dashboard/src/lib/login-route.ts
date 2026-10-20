import { redirect } from '@tanstack/react-router';
import type { Session } from '#lib/auth.ts';
import { sameOriginPath } from '#lib/same-origin-path.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

type LoginSearch = { redirect?: string };

export function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return { redirect: sameOriginPath(search.redirect) };
}

export function beforeLogin({
  context,
  search,
  location,
}: {
  context: { session: Session | null };
  search: LoginSearch;
  location: { searchStr: string };
}) {
  if (
    context.session &&
    !context.session.user.isAnonymous &&
    !new URLSearchParams(location.searchStr).has('sig')
  ) {
    throw redirect({ href: search.redirect ?? IndexRoute.to });
  }
}
