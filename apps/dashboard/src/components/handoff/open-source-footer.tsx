import { GITHUB_REPO_URL } from '@repo/global-constants';
import { GithubIcon } from '#icons/github-icon.tsx';
import { LANDING_ORIGIN } from '#lib/site.ts';

// A new tab for the repository and the same one for home: whoever is mid-deploy here has a
// binary in storage that only this tab knows about, and only home is worth losing it for.
export function OpenSourceFooter() {
  return (
    <footer className="flex items-center gap-3 text-muted-foreground text-sm">
      <a
        className="inline-flex items-center gap-1.5 hover:underline"
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
      >
        <GithubIcon className="size-4" />
        nibrun is fully open source
      </a>
      <span aria-hidden="true">·</span>
      <a className="hover:underline" href={LANDING_ORIGIN}>
        Home
      </a>
    </footer>
  );
}
