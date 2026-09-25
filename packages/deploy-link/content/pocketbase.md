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
