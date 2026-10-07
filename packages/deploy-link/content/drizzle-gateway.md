Drizzle Gateway is a self-hosted Drizzle Studio: browse tables, edit data and run SQL against
your databases from one web interface. See the [Gateway docs](https://gateway.drizzle.team/docs/how-it-works).

## Quick start

1. Click **Deploy on nibrun**. There is nothing to fill in.
2. Open the URL and add your first database connection.

Saved connections and sessions live on the persistent volume and survive a redeploy.

## Optional password protection

Gateway opens without a password by default. To require administrator sign-in, add a `MASTERPASS`
environment variable with a strong password under **Advanced configuration → Environment variables**
before deploying. Sign in with that password when you open the app.

Setting `MASTERPASS` also enables passcodes for sharing access with other people. The preset
leaves it unset. See the [Docker configuration docs](https://gateway.drizzle.team/docs/docker).

## Good to know

This runs the [official standalone binary](https://gateway.drizzle.team/docs/binary). Gateway is
free to self-host. Its public [repository](https://github.com/drizzle-team/gateway-website)
contains the website and documentation.

Remote databases must be reachable from your app and allow its connections. Local SQLite files
belong under `data/`; to bring an existing database, upload an archive under
**Advanced configuration → Initial data** when creating the app.
