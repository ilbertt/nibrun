Sharkord is a chat server you run yourself — text channels, voice, video and screen sharing.
See [sharkord.com](https://sharkord.com/) for what it can do.

## Quick start

1. Click **Deploy on nibrun**. There is nothing to fill in.
2. **Open the Logs tab and find the owner token.** Sharkord prints it once, on first boot.
3. Open the URL, join your server, and paste the token to claim it. Without it you are just
   another guest on your own server.

## Good to know

WebRTC calls, including voice, video and screen sharing, require an extra public TCP/UDP port,
which is a paid feature. After deploying, open the app in the dashboard and choose **Request extra
port** under **Configuration**, or send a request from the CLI:

```sh
nib paid-request --type extra-public-port --app sharkord --requested-ports-amount 1
```

Sending a request records your interest; it does not enable the port or charge you.
