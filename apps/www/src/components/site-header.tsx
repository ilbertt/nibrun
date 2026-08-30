import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GithubStarLink } from '#components/github-star-link.tsx';
import { HomeLink } from '#components/home-link.tsx';

export function SiteHeader() {
  return (
    <header className="flex w-full items-center justify-between gap-1 py-5">
      <nav className="flex items-center gap-1">
        <HomeLink />
        <Button variant="ghost" size="sm" render={<Link to="/blog" />}>
          Blog
        </Button>
      </nav>
      <div className="flex items-center gap-1">
        <GithubStarLink />
        <DashboardLink />
      </div>
    </header>
  );
}
