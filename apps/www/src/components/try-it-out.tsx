import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { ClaudeMark, CodexMark, CursorMark } from '#components/agent-marks.tsx';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const TRY_IT_PROMPT = `Create my personal drive using ${STARTER_REPO_URL} and deploy it on nibrun.com`;
const PROMPT_PANEL_ID = 'starter-prompt';

export function TryItOut() {
  const { copied, copy } = useClipboardCopy(TRY_IT_PROMPT);
  const [reading, setReading] = useState(false);

  return (
    <section className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <h2 className="text-muted-foreground text-sm">Try it out</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className="flex items-center rounded-full border bg-card/70 shadow-sm backdrop-blur-sm">
        <Button
          variant="ghost"
          size="lg"
          onClick={copy}
          className="rounded-r-none rounded-l-full pr-3"
        >
          {/* Both labels are the same nineteen characters, and the face is monospaced, so the pill
              does not resize under the cursor for the second and a half the confirmation lasts. */}
          {copied ? 'Copied to clipboard' : 'Start with an agent'}
          <span className="flex items-center gap-1.5 text-muted-foreground transition-colors group-hover/button:text-foreground">
            <ClaudeMark />
            <CodexMark />
            <CursorMark />
          </span>
        </Button>
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => setReading(!reading)}
          aria-expanded={reading}
          aria-controls={PROMPT_PANEL_ID}
          aria-label={reading ? 'Hide the prompt' : 'Read the prompt first'}
          className="rounded-r-full rounded-l-none"
        >
          <ChevronDownIcon
            className={`transition-transform duration-200 ${reading ? 'rotate-180' : ''}`}
          />
        </Button>
      </div>
      {reading && (
        <div
          id={PROMPT_PANEL_ID}
          className="fade-in-0 slide-in-from-top-1 flex w-full animate-in flex-col items-center gap-3 rounded-2xl border bg-card/70 p-4 shadow-sm backdrop-blur-sm duration-200"
        >
          <p className="text-pretty break-words text-center text-sm leading-relaxed">
            {TRY_IT_PROMPT}
          </p>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copied ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
      )}
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
