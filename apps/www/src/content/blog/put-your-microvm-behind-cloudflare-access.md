---
title: Put your microVM behind Cloudflare Access
description: Protect a nibrun app with your team's Cloudflare login and let MCP clients sign in through the same Access policy.
date: 2026-11-19
---

Say your binary serves an internal dashboard at `ops.example.com` and an MCP endpoint
at `/mcp`. You want teammates to use both with the account they already have at work.
Cloudflare Access can handle sign-in for both. nibrun checks each HTTP request before
it reaches your app, so you can keep running the same binary.

## Set up the hostname in Cloudflare

Start with a custom domain attached to your nibrun app. In Cloudflare DNS, enable the
proxy on the CNAME for that hostname so requests pass through Access.

In Cloudflare Zero Trust, open **Access controls → Applications** and add a
**Self-hosted** application. Enter the full hostname, such as `ops.example.com`, and
leave the path empty to cover both the dashboard and `/mcp`. Add an **Allow** policy
for the teammates who should have access. Save the application and copy its
**Application Audience (AUD) Tag**. [Cloudflare's self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

## Connect the policy to your microVM

Open your app in the nibrun dashboard and choose **Update**. Expand **HTTP access**,
select **Cloudflare Access**, and enter your **Team domain** (for example,
`acme.cloudflareaccess.com`) and the **Application audience (AUD)** you just copied.

![HTTP access in the nibrun deploy dialog, with Cloudflare Access selected and fields for the team domain and application audience.](/blog/cloudflare-access.png)

Submit the deployment. nibrun reuses your binary and applies the policy when the
deployment goes live. Open your custom hostname in a private browser window and sign
in as an allowed teammate. Then try the app's default nibrun URL in a fresh private
window. nibrun should deny that request because it has no signed Access token for this app.

## Connect an MCP client

If Cloudflare will handle sign-in for your MCP server, open the same Access application
and turn on **Managed OAuth** under **Advanced settings**. Allow your client's redirect
URI and save. Point an MCP client that supports OAuth resource indicators (RFC 8707)
at `https://ops.example.com/mcp`. It opens your browser for sign-in and then uses its
access token to call the server. [Cloudflare's Managed OAuth guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)

For both the browser and the MCP client, Cloudflare sends a signed JWT in
`Cf-Access-Jwt-Assertion`. nibrun verifies the signature, issuer and audience,
then forwards the assertion to your app. Your binary can read it when it needs to
know which teammate made the request.
