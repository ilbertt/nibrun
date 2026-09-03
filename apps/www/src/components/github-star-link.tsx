import { GITHUB_REPO_URL } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { GithubMark } from '#components/github-mark.tsx';

// A new tab, unlike everything else in the header: this one leaves nibrun entirely, and taking
// the page with it would cost anyone mid-drop the binary they already picked.
export function GithubStarLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Star nibrun on GitHub"
      render={<a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" />}
    >
      <GithubMark data-icon="inline-start" />
      Star
    </Button>
  );
}
