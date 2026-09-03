# @repo/global-constants

Values more than one workspace has to agree on and nobody deploys: the repository on GitHub, the
public domain and what hangs off it, the free tier's size.

## What belongs here

- **Only what a second workspace needs.** A value one app uses stays in that app —
  `SITE_DESCRIPTION` is www's copy, not a constant.
- **Only what a build cannot vary.** Anything that differs per deployment is an environment
  variable and stays one; tenant apps' domain (`APP_HOST_DOMAIN`) is the reason there is no
  constant for it here.
- **Nothing about the control protocol.** Defaults a host and the control plane both compile
  against are `@repo/protocol`'s.
- No dependencies, no imports outside this package.
