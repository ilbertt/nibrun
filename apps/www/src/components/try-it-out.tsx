import { BASE_DOMAIN } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { ClaudeMark, CodexMark, CursorMark } from '#components/agent-marks.tsx';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const TRY_IT_PROMPT = `Create my personal drive using ${STARTER_REPO_URL} and deploy it on ${BASE_DOMAIN}`;
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
      {/* One key, not two: the halves are `ghost` and have no face of their own, so the shell wears
          the `outline` variant's — same edge, same radius, same base as every other button on the
          page. `:active` reaches here from whichever half is pressed. */}
      <div className="key-face flex items-center rounded-2xl border border-border bg-background dark:bg-transparent">
        <Button variant="ghost" size="lg" onClick={copy} className="rounded-r-none pr-3 font-mono">
          {/* Both labels are the same nineteen characters, and this one control stays monospaced so
              that keeps them the same width — the pill does not resize under the cursor for the
              second and a half the confirmation lasts. The page's face is proportional, where
              nineteen characters says nothing about how wide they are. */}
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
          className="rounded-l-none"
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
    </section>
  );
}
