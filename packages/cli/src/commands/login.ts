import { defineCommand } from '@parshjs/core';
import { awaitApproval, openInBrowser, startLogin } from '#lib/device-login.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('login', {
  description: 'Sign this terminal in. Approve it in the browser to finish.',
  options: {},
  handler: async ({ context, print }) => {
    const ui = createUi({ print, interactive: isInteractive() });
    const { apiUrl } = context;

    const started = await startLogin({ apiUrl });
    ui.open('nib login');
    ui.step(`code ${started.user_code}`);
    ui.step(started.verification_uri_complete);
    openInBrowser(started.verification_uri_complete);

    const accessToken = await ui.waitingFor({
      message: 'waiting for you to approve it',
      task: () => awaitApproval({ apiUrl, started }),
    });

    await context.signIn(accessToken);
    ui.done(`Signed in to ${apiUrl}.`);
  },
});
