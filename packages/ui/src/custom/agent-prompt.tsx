import { BASE_DOMAIN } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { ClaudeMark, CodexMark, CursorMark } from '@repo/ui/custom/agent-marks';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const AGENT_PROMPT = `Ask me what I want to build, then build it from ${STARTER_REPO_URL} and deploy it on ${BASE_DOMAIN}.`;
const PROMPT_PANEL_ID = 'starter-prompt';

/** The prompt that turns an agent into the thing that writes the app, handed over to be pasted. */
export function AgentPrompt() {
  const { copied, copy } = useClipboardCopy(AGENT_PROMPT);
  const [reading, setReading] = useState(false);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {/* One key, not two: the halves are `ghost` and have no face of their own, so the shell wears
          the `outline` variant's — same edge, same radius, same base as every other button on the
          page. `:active` reaches here from whichever half is pressed. */}
      <div className="key-face flex items-center rounded-2xl border border-border bg-background dark:bg-transparent">
        <Button variant="ghost" size="lg" onClick={copy} className="rounded-r-none pr-3">
          {/* Both labels sit in the one grid cell, so the pill is as wide as the longer of them and
              does not resize under the cursor for the second and a half the confirmation lasts. */}
          <span className="grid text-center">
            <span className={`col-start-1 row-start-1 ${copied ? 'invisible' : ''}`}>
              Create your app
            </span>
            <span className={`col-start-1 row-start-1 ${copied ? '' : 'invisible'}`}>
              Prompt copied
            </span>
          </span>
          {/* The marks are all that says this is for an agent, so they stay at every width. */}
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
            {AGENT_PROMPT}
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
    </div>
  );
}
