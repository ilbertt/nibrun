WebDAV lets you access your files from a file manager, sync app or backup tool that supports
the protocol. This preset uses [rclone's WebDAV server](https://rclone.org/commands/rclone_serve_webdav/).

## Quick start

1. Choose a username and password on the deploy form.
2. Click **Deploy on nibrun**.
3. Add the app's HTTPS URL to your WebDAV client and sign in with the pair you chose.

Files live on the persistent volume, so they survive a redeploy. The server supports uploads,
downloads, directory listings, copying, moving and deleting files.
