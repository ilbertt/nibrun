import { Link } from '@tanstack/react-router';
import { RecommendedBadge } from '#components/recommended-badge.tsx';
import type { CatalogApp } from '#lib/apps.ts';

export function AppCard({ app }: { app: CatalogApp }) {
  return (
    <li className="panel rounded-lg border border-border/60">
      <Link
        to="/apps/$slug"
        params={{ slug: app.slug }}
        className="group flex h-full flex-col gap-2 rounded-lg p-5 pt-6"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-lg tracking-tight group-hover:text-primary">
            {app.title}
          </span>
          {app.isRecommended ? <RecommendedBadge iconOnly={true} /> : null}
        </span>
        <span className="text-pretty text-muted-foreground text-sm">{app.subtitle}</span>
        <span className="mt-auto pt-3 text-muted-foreground/70 text-xs">{app.category}</span>
      </Link>
    </li>
  );
}
