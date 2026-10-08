OpenList brings local files and cloud storage into one file browser, with previews, sharing
and WebDAV access. The [OpenList docs](https://doc.oplist.org/) cover its storage drivers.

## Quick start

1. Choose an initial admin password on the deploy form.
2. Click **Deploy on nibrun**, open the app's URL, and sign in as `admin` with that password.
3. Open the admin panel at `/@manage` and add a storage provider with its own credentials
   and mount path. A new instance starts with no storage mounts.

Guest access is disabled by default. The initial password only creates the admin account on
first boot; change an existing account's password inside OpenList.

## Store files on the nibrun volume

To use the local persistent volume instead of a cloud provider:

1. Add a **Local** storage with mount path `/files` and root folder `/app/data`.
   Enable link signing and leave thumbnails disabled.
2. In the file browser, create a directory named `files` inside that mount.
3. Edit the storage's root folder to `/app/data/files`, then upload into `/files`.

The dedicated directory keeps your uploaded files separate from OpenList's database and
configuration. Both the files and settings survive a redeploy.

Connect a WebDAV client to `https://<your-app>.nibrun.app/dav/` with your OpenList account.
The local mount appears under `/files/`.

## What has been verified

The official v4.2.6 binary includes the web interface. Admin login, local uploads and downloads,
WebDAV listing and download, and file and settings persistence after redeployment have been
tested on nibrun. Cloud-provider integrations and large concurrent transfers have not.

Media thumbnails need external tools such as FFmpeg. Offline downloads through aria2,
Transmission or qBittorrent need separately available services; the preset does not install them.
