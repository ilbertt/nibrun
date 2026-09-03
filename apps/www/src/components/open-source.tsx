import { Button } from '@repo/ui/components/button';
import { GithubMark } from '@repo/ui/custom/github-mark';
import { GithubRepoLink } from '@repo/ui/custom/github-repo-link';
import { StarIcon } from 'lucide-react';

export function OpenSource() {
  return (
    <section className="flex w-full flex-col items-start gap-8 border-border/60 border-t py-16 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          All of nibrun is open source.
        </h2>
        <p className="text-pretty text-muted-foreground">
          The dashboard, the API, the CLI, the agent inside the microVM, and the Terraform that
          stands the fleet up — all of it, Apache-2.0. Read it before you hand it a binary, or run
          the whole thing on your own AWS account.
        </p>
      </div>
      {/* Outlined rather than primary: the deploy CTA a section below is the page's one green
          button, and a second one this close would make the visitor choose between them. Size is
          what carries the emphasis instead. */}
      <Button
        variant="outline"
        size="lg"
        className="h-11 gap-2 px-5 text-base has-data-[icon=inline-start]:pl-4"
        render={<GithubRepoLink />}
      >
        <GithubMark data-icon="inline-start" className="size-5" />
        Star on GitHub
        <StarIcon className="size-4 fill-primary text-primary" />
      </Button>
    </section>
  );
}
