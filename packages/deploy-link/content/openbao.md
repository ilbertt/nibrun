OpenBao stores secrets encrypted on disk and controls who can read them through tokens and
policies. It includes a web UI and an HTTP API. The [OpenBao docs](https://openbao.org/docs/)
cover secret engines, authentication methods and access policies.

## Prepare the configuration

This preset runs the official release with persistent PebbleDB storage. OpenBao needs a
configuration file before it can start. Save the following as `openbao.hcl`:

```hcl
ui = true
cache_size = 4096
cluster_addr = "https://127.0.0.1:8201"
log_level = "info"

storage "pebbledb" {
  path = "/app/data/pebble"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  cluster_address = "127.0.0.1:8201"
  tls_disable = true
}
```

Pack the file into an archive with the configuration at its root:

```sh
tar -czf openbao-data.tar.gz openbao.hcl
```

nibrun provides the public HTTPS endpoint. OpenBao's HTTP listener stays inside the guest.

## Quick start

1. Click **Deploy on nibrun**. In **Initial data**, upload `openbao-data.tar.gz`, then deploy.
   The preset already fills in the release, port, arguments and environment.
2. Open your app's URL at `/ui/`. Initialize OpenBao with **3 key shares** and a **key threshold
   of 2**.
3. Save the three unseal keys and initial root token somewhere you control. They are needed to
   recover access; keep them outside the app's volume.
4. Submit two different unseal keys, then sign in using the **Token** method and the initial
   root token.
5. Enable a **KV** secrets engine with **version 2** at `secrets/`, then write your first secret.
   Create policies and credentials for everyday use before sharing access to the app.

## Restarts and storage

The configuration and encrypted secrets live in `data/` and survive redeployment. Initial data
is only uploaded when creating the app; a redeploy uses the configuration already on its volume.

After a cold restart or redeploy, OpenBao starts sealed. Open `/ui/` and submit two of your
existing unseal keys again. This preset does not configure auto-unseal. nibrun may show the app
as running while OpenBao is sealed; the API is ready once it has been unsealed.

The preset sets a Go memory limit of 128 MiB and the configuration limits the storage cache to
4,096 entries for nibrun's 256 MiB guest. UI access, token authentication, versioned secret reads
and writes, and persistence across redeployment have been verified. Large workloads, additional
secret engines and idle sleep/wake behavior have not been verified.
