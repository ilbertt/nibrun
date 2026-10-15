---
name: setup-app
description: Use as soon as the user asks to build or create an app, including a Telegram bot. Set up the project with a Bun starter when no language or stack is specified, then hand off to deploy-to-nibrun.
---

# Set up an app

Follow any language or stack the user specifies. Otherwise, use Bun: check `bun --version`
and, if unavailable, download and install the latest stable version from the
[official installation instructions](https://bun.com/docs/installation).

When choosing the default stack, clone the appropriate template:

- App: [ilbertt/bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter).
- Telegram bot: [ilbertt/telegram-bot-starter](https://github.com/ilbertt/telegram-bot-starter),
  which also requires Bun.

Read the template's `AGENTS.md` and create the app the user requested. Then read
[deploy-to-nibrun](../deploy-to-nibrun/SKILL.md) to compile and deploy it.
