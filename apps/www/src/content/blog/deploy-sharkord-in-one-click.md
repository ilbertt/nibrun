---
title: Deploy Sharkord in one click
description: Self-hosted voice, video and screen sharing. The voice is the part that makes it hard to host.
date: 2026-09-05
---

[Sharkord](https://sharkord.com) is Discord you run yourself. Voice channels with video and screen
sharing, text channels with threads and reactions, direct messages, roles, custom emoji, file
uploads. It ships as one compiled binary with the server and the web client inside it, and a
[mediasoup](https://mediasoup.org) SFU carrying the media.

Running it is one line. Putting it where other people can reach it is the hard part, because voice
needs something an HTTP platform does not hand out.

## The current world

Two things have to be true at once, and the usual answers give you one of them.

The first is HTTPS. Browsers only hand a page a camera, a microphone or a screen in a secure
context, so an installation on plain HTTP is a text chat with the interesting buttons broken.

The second is a port of its own. WebRTC media does not travel over the HTTPS connection that
served the page. It is a separate flow, on UDP, straight to the machine, and a platform that
terminates TLS and forwards HTTP has nothing to forward it through.
[Railway](https://railway.com) does not accept inbound UDP. Neither does
[Render](https://render.com). [Fly](https://fly.io) will, but you buy a dedicated IPv4 for it,
declare the service in `fly.toml`, and bind `fly-global-services` instead of `0.0.0.0`.

So the answer becomes a VM, and along with the UDP port you have signed up for the TLS certificate
and its renewal, the reverse proxy in front of the HTTP side, the firewall rule for the media
port, the OS updates and the backups. Not for an evening. For as long as the thing is up.

## Fulfilling the promise

nibrun hands it both.

Grab `sharkord-linux-x64` from the [releases
page](https://github.com/sharkord/sharkord/releases) and drop it onto
[nibrun.com](https://nibrun.com). You land on the deploy screen with the binary already attached.
What is left:

**HTTP port**: `4991`, Sharkord's own default.

**Additional ports**: tick *Give this app a public port besides HTTPS*. You do not pick the
number. nibrun assigns one, TCP and UDP, and tells the app which address and port it got.

**Environment variables**:

```
SHARKORD_DATA_PATH=data
SHARKORD_AUTOUPDATE=false
SHARKORD_WEBRTC_PORT=${NIBRUN_EXTRA_PUBLIC_PORT}
SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=${NIBRUN_PUBLIC_IPV4}
```

Deploy. Or follow this link, which is that same screen already configured, the binary included:

[**Deploy Sharkord on nibrun**](https://nibrun.com/deploy/sharkord)

`SHARKORD_DATA_PATH` puts the database and the uploads on the volume that survives redeploys, and
it is the one you cannot leave out: without it Sharkord falls back to `~/.config/sharkord`, and
`$HOME` in the guest is a directory the app does not own, so it dies on the first `mkdir` before it
ever binds a port. `SHARKORD_AUTOUPDATE=false` because the artifact you deployed is what boots;
upgrading is a redeploy.

The last two are what an HTTP platform has no answer for. The guest expands `${…}` before the
process starts, so Sharkord binds the port this deployment was assigned and announces the address
it is actually reached at, rather than going off to ask an external service what its own address
is.

There is a CLI too, if your mouse click doesn't work anymore:

```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
```

The same deploy in one command, with the binary as a url so nothing is uploaded from your machine:

```sh
nib run https://github.com/sharkord/sharkord/releases/latest/download/sharkord-linux-x64 \
  --name sharkord --port 4991 --extra-public-port \
  --env SHARKORD_DATA_PATH=data \
  --env SHARKORD_AUTOUPDATE=false \
  --env 'SHARKORD_WEBRTC_PORT=${NIBRUN_EXTRA_PUBLIC_PORT}' \
  --env 'SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=${NIBRUN_PUBLIC_IPV4}'
```

The single quotes on the last two matter. Without them your own shell expands the names first, and
the app is handed two empty strings.

## The owner token

On its first start Sharkord prints an access token to its log, once. It grants owner, and it is
the key the server signs every session and file URL with. It is not shown again.

It's under the app's Logs tab in the dashboard, or from the terminal:

```sh
nib apps logs --app sharkord
```

Save it, then open `https://<your-app>.nibrun.app` and create your account. The HTTPS that makes
the camera, microphone and screen-share buttons work is already there, and there was no
certificate to obtain.

## How the alternatives compare

| | What you build first | Whether voice works |
| --- | --- | --- |
| **nibrun** | Nothing. The binary is the artifact | Yes. A public TCP and UDP port, assigned and announced for you |
| **Fly.io** | A Dockerfile, a `fly.toml`, a volume, a dedicated IPv4 | Yes, once the app binds `fly-global-services` rather than `0.0.0.0` |
| **Render** | A Dockerfile, a service definition, a disk on a paid instance | No. No inbound UDP |
| **Railway** | A Dockerfile or a buildpack it guesses at, plus a volume | No. No inbound UDP |
| **A VPS** | A user, a systemd unit, a reverse proxy, a TLS certificate, a firewall, a backup job | Yes, and the firewall rule is yours to get right |

The machine is one size, which is the bet rather than a limitation we mean to fix: [small apps
don't need to scale](/blog/small-apps-dont-need-to-scale). A group of friends or a small community
fits on it. A server of hundreds does not.
