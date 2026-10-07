import { GithubMark } from '@repo/ui/custom/github-mark';
import { Link } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { type CatalogApp, projectLink } from '#lib/apps.ts';

export function AppSidebar({ app }: { app: CatalogApp }) {
  const project = projectLink(app);

  return (
    <dl className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">{project.label}</dt>
        <dd>
          <a
            className="inline-flex items-center gap-1.5 underline"
            href={project.url}
            target="_blank"
            rel="noreferrer"
          >
            {project.isRepository ? (
              <GithubMark className="size-4" />
            ) : (
              <Globe className="size-4" />
            )}
            {project.name}
          </a>
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">Version</dt>
        <dd className="font-mono">{app.version}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs uppercase tracking-wide">Category</dt>
        <dd>
          <Link to="/apps" search={{ category: app.category }} className="underline">
            {app.category}
          </Link>
        </dd>
      </div>
    </dl>
  );
}
