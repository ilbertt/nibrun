import { Button } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DashboardLink } from '#components/dashboard-link.tsx';
import { GithubLink } from '#components/github-link.tsx';

// The left is a slot rather than a fixed home link: the landing page carries the brand mark in
// its own hero, a few hundred pixels below, and a second one in the header reads as a stutter.
export function SiteHeader({ left }: { left?: ReactNode }) {
  return (
    <header className="flex w-full items-center justify-between gap-1 py-5">
      <div className="flex items-center gap-1">{left}</div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" render={<Link to="/blog" />}>
          Blog
        </Button>
        <GithubLink />
        <DashboardLink />
      </div>
    </header>
  );
}
