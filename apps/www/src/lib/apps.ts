import { DEPLOY_PRESETS, type DeployPreset, type DeploySlug } from '@repo/deploy-link';
import { renderMarkdown } from '#lib/markdown.ts';

export type CatalogApp = DeployPreset & { slug: DeploySlug };

/** What the catalog says about itself, on its page and on the card it unfurls as. */
export const CATALOG = {
  heading: 'One-click deploys',
  description:
    'Open source apps that already ship a single binary, deployed straight from their release assets. No infra needed.',
  cardPath: '/apps.png',
};

/**
 * In the order the presets are written, which is the order the README lists them and the order
 * the deploy button rolls through — one sequence for the catalog rather than a third opinion.
 */
export const APPS: readonly CatalogApp[] = Object.entries(DEPLOY_PRESETS).map(([slug, preset]) => ({
  ...preset,
  slug: slug as DeploySlug,
}));

export function findApp(slug: string): CatalogApp | undefined {
  return APPS.find((app) => app.slug === slug);
}

export function appCardPath(app: CatalogApp): string {
  return `/apps/${app.slug}.png`;
}

export function renderApp(app: CatalogApp): string {
  return renderMarkdown(app.markdownContent);
}

/** `owner/repo`, which is what a repository is called where one is named rather than followed. */
export function repoName(app: CatalogApp): string {
  return new URL(app.repositoryUrl).pathname.slice(1);
}
