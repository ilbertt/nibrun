Drizzle Gateway is a self-hosted Drizzle Studio: browse tables, edit data and run SQL against
your databases from one web interface. See the [Gateway docs](https://gateway.drizzle.team/docs/how-it-works).

## Quick start

1. Enter a strong master password in the deploy form. You will use it to sign in as the administrator.
2. Click **Deploy on nibrun**.
3. Open the URL, sign in with your master password, and add your first database connection.

Saved connections and sessions live on the persistent volume and survive a redeploy. You can
create passcodes to share access with other people.

## Good to know

This runs the [official standalone binary](https://gateway.drizzle.team/docs/binary). Gateway is
free to self-host. Its public [repository](https://github.com/drizzle-team/gateway-website)
contains the website and documentation.

Remote databases must be reachable from your app and allow its connections. Local SQLite files
belong under `data/`; to bring an existing database, upload an archive under
**Advanced configuration → Initial data** when creating the app.
