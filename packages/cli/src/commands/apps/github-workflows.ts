import { defineCommand } from '@parshjs/core';

export const command = defineCommand('apps github-workflows', {
  description: 'Configure the GitHub Actions workflow allowed to deploy this app without API keys.',
  options: {},
});
