import { DEPLOY_PRESETS, type DeployPreset, type DeploySlug } from '@repo/deploy-link';
import { WWW_DEPLOY_PATH } from '@repo/global-constants';
import { renderMarkdown } from '#lib/markdown.ts';

export type CatalogApp = DeployPreset & { slug: DeploySlug };

/** What the catalog says about itself, on its page and on the card it unfurls as. */
export const CATALOG = {
  heading: 'One-click deploys',
  description:
    'Self-hosted apps that already ship a single binary, deployed straight from their release assets. No infra needed.',
  cardPath: '/apps.png',
  markdownPath: '/apps.md',
};

/**
 * In the order the presets are written and the deploy button rolls through — one sequence for
 * the catalog rather than a second opinion.
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

export function appMarkdownPath(app: CatalogApp): string {
  return `/apps/${app.slug}.md`;
}

export function appDeployPath(app: CatalogApp): string {
  return `${WWW_DEPLOY_PATH}/${app.slug}`;
}

export function renderApp(app: CatalogApp): string {
  return renderMarkdown(app.markdownContent);
}

export function projectLink(app: CatalogApp) {
  const url = new URL(app.projectUrl);
  const isRepository = url.hostname === 'github.com';

  return {
    url: app.projectUrl,
    isRepository,
    label: isRepository ? 'Repository' : 'Website',
    name: isRepository ? url.pathname.slice(1) : url.hostname,
  };
}
