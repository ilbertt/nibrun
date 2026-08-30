import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GithubStarLink } from '#components/github-star-link.tsx';

// The left is a slot rather than a fixed home link: the landing page carries the brand mark in
// its own hero, a few hundred pixels below, and a second one in the header reads as a stutter.
// Equal outer columns rather than `justify-between`, so the middle stays centred on the page
// whether or not that slot is filled.
export function SiteHeader({ left }: { left?: ReactNode }) {
  return (
    <header className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1 py-5">
      <div className="flex items-center gap-1">{left}</div>
      <nav className="flex items-center gap-1">
        <Button variant="ghost" size="sm" render={<Link to="/blog" />}>
          Blog
        </Button>
        <GithubStarLink />
      </nav>
      <div className="flex items-center justify-end">
        <DashboardLink />
      </div>
    </header>
  );
}
