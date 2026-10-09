OpenCloud is a private file cloud with a web interface, file sharing and WebDAV access.
The [OpenCloud docs](https://docs.opencloud.eu/) cover administration and client setup.

## Prepare the configuration

This preset runs the official Linux AMD64 binary with its files and configuration on the
persistent volume. OpenCloud needs an initialized configuration before it can start.

1. From the [official releases](https://github.com/opencloud-eu/opencloud/releases), download
   the same version shown by this preset for your local operating system and architecture.
   For example, an Apple Silicon Mac uses the `darwin-arm64` binary. Rename it to `opencloud`.
2. On macOS or Linux, make the downloaded binary executable and generate a fresh configuration:

   ```sh
   chmod +x ./opencloud
   ./opencloud init --insecure=false --config-path ./opencloud-data
   ```

3. Save the generated admin password printed by the initializer. Your username is `admin`.
   Keep `opencloud-data/opencloud.yaml` private: it contains installation secrets.
4. Pack the configuration with `opencloud.yaml` at the archive root:

   ```sh
   tar -czf opencloud-data.tar.gz -C opencloud-data opencloud.yaml
   ```

Generate a separate configuration for each new installation. The local binary only initializes
it; nibrun runs the Linux binary already selected by the preset.

## Quick start

1. Click **Deploy on nibrun**. In **Initial data**, upload `opencloud-data.tar.gz`, then deploy.
   The preset fills in the release, port, arguments and environment.
2. Open the app's URL and sign in as `admin` with the password saved during initialization.
3. Upload a file through the web interface. Create additional accounts in the admin settings
   before sharing access.

nibrun provides public HTTPS. OpenCloud's proxy listens on HTTP inside the guest; the preset's
insecure backend settings allow OpenCloud's internal self-generated certificates.

## Storage and resource limits

The configuration lives at `/app/data/opencloud.yaml`; application state and uploaded files live
under `/app/data/opencloud`. Both survive redeployment. Initial data is only uploaded when
creating the app. Keep the existing configuration when redeploying and export the app for backups.

The preset tunes Go memory usage and concurrency for nibrun's 256 MiB guest. Admin login,
106-byte and 2 MiB uploads, file persistence after redeployment, and a checksum-matching 2 MiB
download have been verified. Concurrent users, large transfers and idle sleep/wake behavior
have not been verified.

By default, nibrun sleeps the app after five minutes without traffic. OpenCloud's background
work pauses while the app sleeps. The filesystem watcher is disabled; upload files through
OpenCloud rather than changing its storage files directly.
