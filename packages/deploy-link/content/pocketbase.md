PocketBase is a backend in one file: an embedded database, user accounts and OAuth, file storage,
realtime subscriptions and an admin UI. The [PocketBase docs](https://pocketbase.io/docs/) cover
the API your app will call.

## Quick start

1. Click **Deploy on nibrun**. There is nothing to fill in.
2. **Open the Logs tab and find the installer link.** PocketBase prints it once, on first boot,
   pointing at `http://0.0.0.0:8090/_/#/pbinstal/<token>` — the address it was told to bind.
3. Swap that host for your app's URL, `https://<your-app>.nibrun.app/_/#/pbinstal/<token>`, and
   create the superuser account there. That is you.
4. Add collections in the admin UI at `/_/`, then call them from your app over REST or the SDKs.

Everything it stores lives on the volume, so it is still there after a redeploy.

## A site and JS hooks, from the first deploy

This deploy keeps PocketBase's two optional folders in `data/`, so an archive dropped under
**Advanced configuration → Initial data** brings them along. Its root becomes the root of `data/`,
unpacked before PocketBase first starts:

- **`pb_public/`** is served as a static site from the app's URL, and a path it does not hold
  falls back to its `index.html`, so a single-page app works as is. See the
  [PocketBase introduction](https://pocketbase.io/docs/).
- **`pb_hooks/`** holds `*.pb.js` files that extend PocketBase in JavaScript: custom routes, event
  hooks, scheduled jobs. See [Extend with JavaScript](https://pocketbase.io/docs/js-overview/).

The archive is only read as the app is created; a redeploy keeps whatever `data/` already holds.
