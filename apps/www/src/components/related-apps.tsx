import { Link } from '@tanstack/react-router';
import { APPS, type CatalogApp } from '#lib/apps.ts';

const RELATED_SHOWN = 4;

export function RelatedApps({ app }: { app: CatalogApp }) {
  const related = APPS.filter(
    (other) => other.slug !== app.slug && other.category === app.category,
  ).slice(0, RELATED_SHOWN);

  if (related.length === 0) {
    return null;
  }

  return (
    // Clear of the article rather than tight against it: the rule reads as the end of what was
    // being read, and it needs the room to say so.
    <section className="mt-16 border-border/60 border-t pt-10 sm:mt-20">
      <h2 className="pb-4 text-muted-foreground text-xs uppercase tracking-wide">
        <Link to="/apps" search={{ category: app.category }} className="hover:text-primary">
          More in {app.category}
        </Link>
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {related.map((other) => (
          <li key={other.slug}>
            <Link
              to="/apps/$slug"
              params={{ slug: other.slug }}
              className="group flex flex-col gap-1"
            >
              <span className="font-medium group-hover:text-primary">{other.title}</span>
              <span className="text-muted-foreground text-sm">{other.subtitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
