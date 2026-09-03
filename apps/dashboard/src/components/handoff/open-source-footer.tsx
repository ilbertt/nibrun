import { GithubMark } from '@repo/ui/custom/github-mark';
import { GithubRepoLink } from '@repo/ui/custom/github-repo-link';

export function OpenSourceFooter() {
  return (
    <footer className="mt-6 text-muted-foreground text-sm">
      <GithubRepoLink className="inline-flex items-center gap-1.5 hover:underline">
        <GithubMark className="size-4" />
        nibrun is fully open source
      </GithubRepoLink>
    </footer>
  );
}
