# @repo/global-constants

Values a workspace cannot decide alone and nobody deploys: the repository on GitHub, the two
public sites and the domain they share, the free tier's size.

## What belongs here

- **A site is a `Site`.** `WWW_SITE` and `DASHBOARD_SITE` carry the same fields, so a constant
  never has to say which of the two it means. Anything named `SITE_*` is ambiguous by
  construction — put it on the object instead.
- **Only what a build cannot vary.** Anything that differs per deployment is an environment
  variable and stays one; tenant apps' domain (`APP_HOST_DOMAIN`) is the reason there is no
  constant for it here.
- **Nothing about the control protocol.** Defaults a host and the control plane both compile
  against are `@repo/protocol`'s.
- No dependencies, no imports outside this package.

`apps/dashboard/index.html` is served rather than rendered, so it cannot import any of this. Its
head carries `%TOKEN%` placeholders that the `site-head` plugin in `apps/dashboard/vite.config.ts`
fills from `DASHBOARD_SITE` — a tag added there needs its token registered.
