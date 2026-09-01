import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GithubStarLink } from '#components/github-star-link.tsx';
import { HomeLink } from '#components/home-link.tsx';

// Equal outer columns are what hold the middle one to the centre of the page, and they cost the
// width of the wider side twice — which a phone does not have. Below `sm` the middle takes the
// free space instead, and only the pair at the end stays pinned to it.
export function SiteHeader() {
  return (
    <header className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-1 pt-5 pb-16 sm:grid-cols-[1fr_auto_1fr]">
      <HomeLink />
      <div className="flex items-center justify-center gap-1">
        {/* Routed to the page rather than the fragment alone: this header is on the blog too, and
            a bare `#pricing` there is a link to nothing. */}
        <Button variant="ghost" size="sm" render={<Link to="/" hash="pricing" />}>
          Pricing
        </Button>
        <Button variant="ghost" size="sm" render={<Link to="/blog" />}>
          Blog
        </Button>
      </div>
      <div className="flex items-center justify-end gap-1">
        <GithubStarLink />
        <DashboardLink />
      </div>
    </header>
  );
}
