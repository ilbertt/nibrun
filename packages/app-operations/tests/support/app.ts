/** The one app these tests are about, and what it was deployed from. */
export const SLUG = 'quiet-otter';
export const APP_ID = 'app-1';
export const ARTIFACT_ID = 'artifact-1';
export const DIGEST = 'sha256:abcd';

export type HostnameRow = { hostname: string; kind: string; state: string };

export const PLATFORM: HostnameRow = {
  hostname: `${SLUG}.nibrun.app`,
  kind: 'platform',
  state: 'active',
};
