---
title: Deploy Sharkord in one click
description: Your own Discord, without the part where you become a sysadmin.
date: 2026-09-05
---

[Sharkord](https://sharkord.com) is Discord you run yourself. Voice channels with video and screen
sharing, text channels with threads and reactions, direct messages, roles, custom emoji, file
uploads — the parts a group actually uses, in one compiled binary with the server and the web
client inside it.

The appeal is the obvious one: the server is yours, the history is yours, and nobody changes the
terms on you. The catch is what "yours" has meant up to now.

## The current world

Two options, and neither is the one you want.

Discord is free and someone else's. It works, everyone is already there, and your group's history
sits at the pleasure of a company that owes you nothing. That's the deal, and for most groups it
is fine right up until it isn't.

Self-hosting is the other one, and it was never really about the app. Sharkord is a binary you can
run in one line. It's about the machine you have just taken on: a VPS, a user to run it as, a
systemd unit, a reverse proxy in front of it, a TLS certificate and the job that renews it, OS
updates, and a backup you have to remember to test. Voice adds a firewall rule, because WebRTC
media is a UDP flow straight to the machine rather than something the HTTPS connection carries —
one more thing to get wrong, and the symptom is a call that connects and stays silent.

A platform is not the third option here. [Railway](https://railway.com) and
[Render](https://render.com) don't accept inbound UDP at all, so voice simply does not work on
them, and [Fly](https://fly.io) wants a dedicated IPv4 and a `fly-global-services` bind on top of
the Dockerfile and the volume.

So it's a systems administration hobby, taken up so that five friends can talk. Most people price
that correctly and stay on Discord.

## Fulfilling the promise

Grab `sharkord-linux-x64` from the [releases
page](https://github.com/sharkord/sharkord/releases) and drop it onto
[nibrun.com](https://nibrun.com). You land on the deploy screen with the binary already attached.
What is left:

**HTTP port**: `4991`, Sharkord's own default.

**Additional ports**: tick *Give this app a public port besides HTTPS*. That's the one voice needs.
You don't pick the number — nibrun assigns one, TCP and UDP, and tells the app which address and
port it got.

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
it's the one you can't leave out: without it Sharkord falls back to `~/.config/sharkord`, and
`$HOME` in the guest is a directory the app doesn't own, so it dies on the first `mkdir` before it
ever binds a port. `SHARKORD_AUTOUPDATE=false` because the artifact you deployed is what boots;
upgrading is a redeploy.

The last two are the firewall rule you didn't have to write. The guest expands `${…}` before the
process starts, so Sharkord binds the port this deployment was actually assigned and announces the
address it is actually reached at.

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

## What you're actually signing up for

| | What you maintain | Whose server it is |
| --- | --- | --- |
| **Discord** | Nothing | Theirs. Their rules, their retention, their terms |
| **A VPS** | The OS, the TLS certificate, the reverse proxy, the firewall, the backups | Yours, once you've finished building it |
| **nibrun** | Nothing. The binary is the artifact | Ours, but nothing on it is |

That last cell is the honest one. The machine is still someone else's computer, same as Discord.
What differs is that nothing running on it belongs to us: the binary is the one you uploaded, the
disk is a directory your app writes to, and both come back with one command whenever you want out.

One microVM, one size, for a group of friends or a small community. That's the bet rather than a
limitation we mean to fix: [small apps don't need to
scale](/blog/small-apps-dont-need-to-scale).
