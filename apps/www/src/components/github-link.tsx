import { Button } from '@repo/ui/components/button';
import { GithubMark } from '#components/github-mark.tsx';
import { REPO_URL } from '#lib/site.ts';

// A new tab, unlike the sign-in beside it: this one leaves nibrun entirely, and taking the page
// with it would cost anyone mid-drop the binary they already picked.
export function GithubLink() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="nibrun on GitHub"
      render={<a href={REPO_URL} target="_blank" rel="noreferrer" />}
    >
      <GithubMark />
    </Button>
  );
}
