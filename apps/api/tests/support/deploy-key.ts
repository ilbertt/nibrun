import { DeployKeyIdSchema, Value } from '@repo/protocol';
import type { DeployKeyRow } from '#repositories/deploy-keys.repository.ts';
import { APP_ID } from '#tests/services/support/fixtures.ts';

export const DEPLOY_KEY_ID = Value.Parse(DeployKeyIdSchema, 'key-1');
export const DEPLOY_PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGUXx6avvDyK80iLOOEAcMpOiz7c5X15hOJDGvAPOeWj';
// Recorded from ssh-keygen -lf, independently of the parser under test.
export const DEPLOY_KEY_FINGERPRINT = 'SHA256:oVkwcIXwSc+fPzoGgHZH7miFHMuKgNGqLChKtPuyjBs';

export function deployKeyRow(): DeployKeyRow {
  return {
    id: DEPLOY_KEY_ID,
    app_id: APP_ID,
    name: 'GitHub Actions',
    public_key: DEPLOY_PUBLIC_KEY,
    created_at: new Date(),
  };
}
