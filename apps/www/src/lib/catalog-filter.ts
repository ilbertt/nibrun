import { DeployCategory } from '@repo/deploy-link';
import { APPS, type CatalogApp } from '#lib/apps.ts';

export const ALL = 'All';

export type Chip = DeployCategory | typeof ALL;

/** What the address carries. A filter nothing is under is the whole catalog, which is `undefined`. */
export type CatalogSearch = { category: DeployCategory | undefined };

// Read off the enum rather than trusted: this comes out of somebody's address bar, and a member
// that does not exist would be a filter that empties the page with no way back but editing the URL.
export function asCategory(value: unknown): DeployCategory | undefined {
  return Object.values(DeployCategory).find((member) => member === value);
}

export function matches({ app, query }: { app: CatalogApp; query: string }): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === '' ||
    app.title.toLowerCase().includes(needle) ||
    app.subtitle.toLowerCase().includes(needle) ||
    app.slug.includes(needle)
  );
}

/** How many the chip would leave on screen, which is what makes the row read as a tally. */
export function counted(name: Chip): number {
  return name === ALL ? APPS.length : APPS.filter((app) => app.category === name).length;
}
