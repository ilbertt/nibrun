import { GITHUB_REPO_URL } from '@repo/global-constants';
import type { ComponentProps } from 'react';

// A new tab: this one leaves the site entirely, and taking the page with it would cost anyone
// mid-deploy the binary only that tab knows about.
export function GithubRepoLink(props: Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'>) {
  return <a {...props} href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" />;
}
