import { defineCommand } from '@parshjs/core';

export const command = defineCommand('apps sqlite connections', {
  description: 'Manage saved connections to SQLite files in an app’s filesystem.',
  options: {},
});
