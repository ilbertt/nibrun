# @repo/analytics

Internal tracking shared by the marketing site, dashboard and API.

- Seed one Umami website named `nibrun` for marketing and dashboard tracking.
- Keep both sites on the same Umami website. Derive its ID from `src/config.ts`
  in clients and seeding; separate websites cannot form one native funnel.
- `www` and `dashboard` identify the emitting site inside the shared collection.
- Require `VITE_UMAMI_HOSTNAME` at build time; do not add a hostname fallback.
- Declare Vite environment types in `src/vite-env.d.ts`, without local casts.
- Keep the browser's Distinct ID stable across sites and sign-in. Changing it
  during authentication splits Umami sessions and breaks conversion funnels.
- Attach the opaque account ID as Umami session data and custom event data, and
  clear it on sign-out. Never send names or emails. Persist the pre-sign-in
  identity state across OAuth so completed sign-ins can distinguish anonymous
  upgrades from visitor logins.
- Use Umami's automatic SPA tracking and documented `data-before-send` hook.
  Add a navigation fallback only for a verified gap in the pinned tracker.
- Gate tracking through `trackingAllowed()`, including custom events. Preserve
  production-host, HTTPS, top-level-window and Do Not Track restrictions.
- Preserve only query parameters whose names start with `utm`, plus URL hashes,
  in pageviews, custom events, identification and performance payloads. Umami
  extracts UTM parameters from the query string. UTM query and hash navigation
  are pageviews; deduplicate by origin, pathname, filtered search and hash.
- Exclude credentials, referrer queries and hashes, app names, custom hostnames,
  file paths, prompt contents, configuration values and raw errors. Opaque app and
  attempt IDs may correlate events; settings events carry changed field names only.
- Define event contracts in `src/events.ts`; derive callers' types from them.
  Keep acquisition context separate from the preset actually deployed.
- Server events use the schema-free `./events` and `./config` subpaths, without
  loading the browser tracker. MCP events use the opaque account ID as their
  Distinct ID and `account_id` data; browser identity remains unchanged.
- Keep server delivery optional outside production, bounded and best effort.
  Respect request Do Not Track headers. Never send tool arguments or results.
- Record outcomes after confirmation. Deployment success requires observed
  `running`; sign-in requires an account session; app claims require the same
  anonymous app to become permanent in that account. Browser events cannot
  guarantee outcomes after the page closes.
- Keep initialization in a `.ts` hook. Add `.tsx` files only when they contain JSX.
