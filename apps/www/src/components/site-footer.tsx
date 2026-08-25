import { BrandMark } from '@repo/ui/custom/brand-mark';
import { GithubLink } from '#components/github-link.tsx';

export function SiteFooter() {
  return (
    <footer className="flex w-full items-center justify-between gap-4 border-border/60 border-t py-8">
      <BrandMark />
      <GithubLink />
    </footer>
  );
}
