import { Button } from '@repo/ui/components/button';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { OpenInMenu } from '#components/open-in-menu.tsx';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const TRY_IT_PROMPT = `Create my personal drive using ${STARTER_REPO_URL} and deploy it on nibrun.com`;
const SKILL_COMMAND = 'npx skills add ilbertt/nibrun';

// Labelled rather than headed: this answers a question the drop zone above it raises, so it has to
// read as that zone's fallback and not as a section competing with the argument further down.
export function TryItOut() {
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-muted-foreground text-sm">Try it out</p>
      <div className="overflow-hidden rounded-2xl border bg-card/80 shadow-sm backdrop-blur-sm">
        <p className="text-pretty break-words px-4 py-3.5 text-sm leading-relaxed">
          {TRY_IT_PROMPT}
        </p>
        <div className="flex items-center justify-between gap-2 border-t bg-muted/50 p-2">
          <CopyPrompt />
          <OpenInMenu prompt={TRY_IT_PROMPT} />
        </div>
      </div>
      <p className="text-pretty text-muted-foreground text-sm">
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
      <p className="text-muted-foreground text-sm">Alternatively, deploy your own app</p>
      <span className="flex w-fit max-w-full items-center gap-0.5 rounded-md border bg-muted py-0.5 pr-0.5 pl-1.5">
        <code className="min-w-0 text-sm">{SKILL_COMMAND}</code>
        <CopyButton value={SKILL_COMMAND} />
      </span>
    </div>
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
