import { GithubMark } from '@repo/ui/custom/github-mark';
import { GithubRepoLink } from '@repo/ui/custom/github-repo-link';
import { WWW_ORIGIN } from '#lib/www-origin.ts';

// Home stays in this tab: whoever is mid-deploy here has a binary in storage that only this tab
// knows about, and home is the one place worth losing it for.
export function OpenSourceFooter() {
  return (
    <footer className="flex items-center gap-3 text-muted-foreground text-sm">
      <GithubRepoLink className="inline-flex items-center gap-1.5 hover:underline">
        <GithubMark className="size-4" />
        nibrun is fully open source
      </GithubRepoLink>
      <span aria-hidden="true">·</span>
      <a className="hover:underline" href={WWW_ORIGIN}>
        Home
      </a>
    </footer>
  );
}
