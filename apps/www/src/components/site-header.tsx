import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GithubStarLink } from '#components/github-star-link.tsx';
import { HomeLink } from '#components/home-link.tsx';

// Equal outer columns are what centre the middle one on the page, and they cost the width of the
// wider side twice — which a phone does not have. Below `sm` the three columns pack left instead.
export function SiteHeader() {
  return (
    <header className="grid w-full grid-cols-[auto_auto_1fr] items-center gap-1 pt-5 pb-16 sm:grid-cols-[1fr_auto_1fr]">
      <HomeLink />
      <Button variant="ghost" size="sm" render={<Link to="/blog" />}>
        Blog
      </Button>
      <div className="flex items-center justify-end gap-1">
        <GithubStarLink />
        <DashboardLink />
      </div>
    </header>
  );
}
