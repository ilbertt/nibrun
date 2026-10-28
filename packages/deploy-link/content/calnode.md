Calnode is a scheduling and booking app with calendar integrations, webhooks and a native MCP
server. It keeps bookings in SQLite and serves its admin UI and public booking pages from one
binary. See the [deployment guide](https://github.com/Calnode/calnode/blob/v0.11.2/DEPLOY.md).

## Quick start

1. Run `openssl rand -hex 32` twice. Paste one result into `CALNODE_ENCRYPTION_KEY` on the deploy
   form and the other into `CALNODE_RECOVERY_SECRET`. Save both securely, with the recovery
   secret stored separately, and reuse them on redeploys.
2. Click **Deploy on nibrun**, then open the URL and complete first-run setup to create the
   owner account. Do this as soon as the app is live: the first visitor can claim it.
3. Configure email and calendar integrations in Settings, then add an event type and availability.

The preset keeps the database and uploaded assets on your persistent volume. If you add a custom
domain, update `BASE_URL` to its full HTTPS URL and update any registered OAuth redirect URLs.

The standalone release does not bundle Litestream: setting `LITESTREAM_REPLICA_URL` alone does
not enable database backups or restore.
