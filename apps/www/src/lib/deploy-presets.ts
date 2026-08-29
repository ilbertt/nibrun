import type { DeployLink } from '@repo/deploy-link';

/**
 * A deploy the app already knows how to configure, under the short address that stands for it.
 * Each one is nothing but the parameters the app's own deploy screen reads, so a link that stops
 * compiling here is one the screen would have read as asking for nothing.
 *
 * Nothing in a preset is a secret or a promise: it prefills fields the owner can still edit, and
 * the api validates what is submitted.
 */
export const DEPLOY_PRESETS = {
  pocketbase: {
    name: 'pocketbase',
    port: 8090,
    arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data'],
    minimal: true,
  },
} satisfies Record<string, DeployLink>;

export type DeploySlug = keyof typeof DEPLOY_PRESETS;

export function findPreset(slug: string): DeployLink | undefined {
  return Object.hasOwn(DEPLOY_PRESETS, slug) ? DEPLOY_PRESETS[slug as DeploySlug] : undefined;
}

/** What the build prerenders, and the one place the slugs and the route agree on an address. */
export const DEPLOY_PATHS = Object.keys(DEPLOY_PRESETS).map((slug) => `/deploy/${slug}`);
