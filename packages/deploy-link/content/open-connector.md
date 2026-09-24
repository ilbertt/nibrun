OpenConnector holds the OAuth tokens for a long list of SaaS providers and exposes ready-made
actions against them, so an agent calls one API instead of implementing a flow per service. See
the [README](https://github.com/oomol-lab/open-connector#readme).

## Quick start

1. The form asks for three secrets — an encryption key, an admin token and a runtime token.
   Generate three long random strings and paste them in. You will need the admin token to sign in.
2. Click **Deploy on nibrun**.
3. Open the URL, sign in with the admin token, and connect your first provider.

Redirect URLs are built from your own address, so the OAuth round trip lands back where it started.
