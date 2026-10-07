import { defineCommand } from '@parshjs/core';

export const command = defineCommand('apps sqlite', {
  description: 'Inspect SQLite databases in an app’s running deployment.',
  options: {},
});
