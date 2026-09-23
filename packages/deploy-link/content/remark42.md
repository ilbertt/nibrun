Remark42 is a comment engine you embed in a static site: threads, voting, moderation, social or
anonymous login, and nobody selling the traffic. The
[Remark42 docs](https://remark42.com/docs/) cover embedding and moderation.

## Quick start

1. Put a long random string in `SECRET` on the deploy form — it signs the sessions.
2. Click **Deploy on nibrun**.
3. Add the embed snippet to your site, pointing at your own URL, and open `/web/` to moderate.

## Good to know

Opening the root of this app answers **404**, and that is correct — Remark42 is a backend. The
demo UI is at `/web/`.
