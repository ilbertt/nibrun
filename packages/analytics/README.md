# @repo/analytics

Both public sites send to the same Umami website, seeded as
`00000000-0000-4000-8000-000000000001`. Paths are prefixed with `/www` or
`/dashboard` so funnels can distinguish their homepages. The old dashboard-only
website is preserved but receives no new tracking.

A random, 90-day `nibrun_analytics` cookie on `nibrun.com` keeps the browser's
Distinct ID stable across both sites and sign-in. It is separate from authentication.
When cookies are unavailable, Umami's default session detection is used. Funnels
still depend on Umami sessions; a change of IP or browser can split a journey.

Tracking runs only on the production site hostnames, in a top-level HTTPS window,
and respects Do Not Track. Umami automatically tracks SPA navigation. Its documented
`data-before-send` hook adds the shared identity and removes
queries, fragments, app IDs, and dynamic page titles. External referrers retain
only their origin. The handoff iframe and route preloads produce no pageviews.

Umami 3.4 does not observe `popstate`, so back/forward navigation reapplies the
current history entry with the same URL and state to update its cached location.
Pageviews are deduplicated by pathname to ignore query-only changes.

`VITE_UMAMI_HOSTNAME` overrides the default `umami.nibrun.com` collector.
CD passes the `UMAMI_HOSTNAME` repository variable into the API image build.
For a separate Cloudflare www build, set `VITE_UMAMI_HOSTNAME` in its build
environment when changing the collector hostname.
