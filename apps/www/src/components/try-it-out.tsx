import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { OpenInMenu } from '#components/open-in-menu.tsx';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const TRY_IT_PROMPT = `Create my personal drive using ${STARTER_REPO_URL} and deploy it on nibrun.com`;

export function TryItOut() {
  return (
    <section className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <h2 className="text-muted-foreground text-sm">Try it out</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card/80 shadow-sm backdrop-blur-sm">
        <p className="text-pretty break-words px-4 py-3.5 text-sm leading-relaxed">
          {TRY_IT_PROMPT}
        </p>
        <div className="flex items-center justify-between gap-2 border-t bg-muted/50 p-2">
          <CopyPrompt />
          <OpenInMenu prompt={TRY_IT_PROMPT} />
        </div>
      </div>
      <p className="text-balance text-center text-muted-foreground text-xs">
        It builds{' '}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={STARTER_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          bun-full-stack-starter
        </a>{' '}
        into one binary, yours to run anywhere — nibrun or not.
      </p>
    </section>
  );
}

function CopyPrompt() {
  const { copied, copy } = useClipboardCopy(TRY_IT_PROMPT);
  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      <Icon data-icon="inline-start" />
      {copied ? 'Copied' : 'Copy prompt'}
    </Button>
  );
}
