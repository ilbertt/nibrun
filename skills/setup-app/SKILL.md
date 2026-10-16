---
name: setup-app
description: Use as soon as the user asks to build or create an app, including a Telegram bot. Set up the project with a Bun starter when no language or stack is specified, then hand off to deploy-to-nibrun.
---

# Set up an app

Follow any language or stack the user specifies. Otherwise, use Bun: check `bun --version`
and, if unavailable, download and install the latest stable version from the
[official installation instructions](https://bun.com/docs/installation).

When choosing the default stack, clone the appropriate template:

- Webapp (with or without backend): [ilbertt/bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter).
- Telegram bot: [ilbertt/telegram-bot-starter](https://github.com/ilbertt/telegram-bot-starter),
  which also requires Bun.

Read the template's `AGENTS.md` and build on the cloned template. If the app needs authentication, use
the template's authentication setup. If the template cannot be retrieved, explain the limitation
before choosing a different starting point.

Verify with build checks and HTTP/API requests. Use a browser for testing only when the user
asks for browser or visual testing.

Then read [deploy-to-nibrun](../deploy-to-nibrun/SKILL.md) to compile and deploy it.
