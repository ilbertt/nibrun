import { defineCommand } from '@parshjs/core';
import { openInBrowser, SIGNED_IN_OUTPUT, startLogin } from '#lib/device-login.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('login', {
  description: 'Sign this terminal in. Approve it in the browser to finish.',
  options: {},
  handler: async ({ context, print, rootOptions }) => {
    const { ui, emit } = createOutput({
      output: SIGNED_IN_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { apiUrl } = context;

    const login = await startLogin({ apiUrl });
    ui.open('nib login');
    ui.step(`code ${login.userCode}`);
    ui.step(login.verificationUrl);
    openInBrowser(login.verificationUrl);

    const accessToken = await ui.waitingFor({
      message: 'waiting for you to approve it',
      task: login.awaitApproval,
    });

    await context.files.credentials.write({ apiUrl, accessToken });
    emit({ apiUrl });
  },
});
