import { Button } from '@repo/ui/components/button';
import { GithubMark } from '@repo/ui/custom/github-mark';
import { GithubRepoLink } from '@repo/ui/custom/github-repo-link';

export function GithubStarLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Star nibrun on GitHub"
      render={<GithubRepoLink />}
    >
      <GithubMark data-icon="inline-start" />
      Star
    </Button>
  );
}
