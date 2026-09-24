import { DEPLOY_PRESETS, type DeployPreset, type DeploySlug } from '@repo/deploy-link';
import { renderMarkdown } from '#lib/markdown.ts';

export type CatalogApp = DeployPreset & { slug: DeploySlug };

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

export function renderApp(app: CatalogApp): string {
  return renderMarkdown(app.markdownContent);
}

/** `owner/repo`, which is what a repository is called where one is named rather than followed. */
export function repoName(app: CatalogApp): string {
  return new URL(app.repositoryUrl).pathname.slice(1);
}
