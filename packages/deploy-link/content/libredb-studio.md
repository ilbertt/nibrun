LibreDB Studio is a browser workspace for exploring schemas, browsing tables and running SQL
against PostgreSQL, MySQL, SQLite and other databases. See the
[project](https://github.com/libredb/libredb-studio) for supported engines and features.

## Quick start

1. Choose an admin password and a separate random `JWT_SECRET` of at least 32 characters.
   The form asks for both before deploying. Keep the secret: it signs sessions and also protects
   saved database credentials.
2. Click **Deploy on nibrun**. The runtime and application are downloaded automatically;
   there is nothing to compile or install.
3. Open the URL and sign in as `admin@libredb.org` with your chosen password. You can change
   the email under **Advanced configuration → Environment variables** before deploying.
4. Try the bundled sample database or add a connection to a database your app can reach.

Saved settings, connections and local databases live on the persistent volume and survive
redeploys. Do not replace `JWT_SECRET` without planning how to re-enter saved connection passwords.

## Good to know

The preset runs the official LibreDB standalone release with Bun in its low-memory mode.
It includes the web interface and dependencies. Remote databases must allow connections from
your app. AI features need a separately configured model provider.

The initial-data archive contains the application itself, so keep the preset's archive URL
when creating the app. Initial data is only imported on creation; updating the runtime or
changing the archive URL later does not upgrade the application files already on the volume.
