# @repo/analytics

Internal tracking shared by the marketing site and dashboard.

- Seed both `www` and `dashboard` websites. Browser tracking shares `www` for
  cross-site funnels; this does not require removing the dashboard seed.
- Keep both sites on the same Umami website. Derive its ID from `src/config.ts`
  in clients and seeding; separate websites cannot form one native funnel.
- Keep the browser's Distinct ID stable across sites and sign-in. Changing it
  during authentication splits Umami sessions and breaks conversion funnels.
- Use Umami's automatic SPA tracking and documented `data-before-send` hook.
  Add a navigation fallback only for a verified gap in the pinned tracker.
- Gate tracking through `trackingAllowed()`, including custom events. Preserve
  production-host, HTTPS, top-level-window and Do Not Track restrictions.
- Sanitize every outgoing payload. Exclude credentials, query/hash values,
  app names, custom hostnames, file paths, prompt contents, configuration values
  and raw errors. Opaque app and attempt IDs may correlate events; settings
  events carry changed field names only.
- Define event contracts in `src/events.ts`; derive callers' types from them.
  Keep acquisition context separate from the preset actually deployed.
- Record outcomes after confirmation. Deployment success requires observed
  `running`; sign-in requires an account session; app claims require the same
  anonymous app to become permanent in that account. Browser events cannot
  guarantee outcomes after the page closes.
- Keep initialization in a `.ts` hook. Add `.tsx` files only when they contain JSX.
