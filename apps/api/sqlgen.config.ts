import { defineConfig } from '@ilbertt/bun-sqlgen/config';

export default defineConfig({
  schemas: ['nibrun'],
  checkMigrationOrder: { prefixPattern: /^[0-9]{4}_/ },
});
