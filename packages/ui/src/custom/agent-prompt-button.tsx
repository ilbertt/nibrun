import { Button } from '@repo/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/popover';
import { ClaudeMark, CodexMark, CursorMark } from '@repo/ui/custom/agent-marks';
import { AgentPromptPreview } from '@repo/ui/custom/agent-prompt-preview';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';

export function AgentPromptButton({
  label,
  prompt,
  compact,
  onCopied,
}: {
  label: string;
  prompt: string;
  compact: boolean;
  onCopied: (() => void) | undefined;
}) {
  const { copied, copy } = useClipboardCopy({ value: prompt, onCopied });
  const panelId = useId();
  const [reading, setReading] = useState(false);

  const previewButton = (
    <Button
      variant="ghost"
      size={compact ? 'icon-xs' : 'icon-lg'}
      onClick={compact ? undefined : () => setReading(!reading)}
      aria-expanded={reading}
      aria-controls={panelId}
      aria-label={reading ? 'Hide the prompt' : 'Read the prompt first'}
      className="rounded-l-none"
    >
      <ChevronDownIcon
        className={`transition-transform duration-200 ${reading ? 'rotate-180' : ''}`}
      />
    </Button>
  );

  return (
    <Popover open={compact && reading} onOpenChange={setReading}>
      <div
        className={`flex flex-col gap-3 ${compact ? 'w-fit items-start' : 'w-full items-center'}`}
      >
        {/* One key, not two: the halves are `ghost` and have no face of their own, so the shell wears
          the `outline` variant's — same edge, same radius, same base as every other button on the
          page. `:active` reaches here from whichever half is pressed. */}
        <div className="key-face flex items-center rounded-2xl border border-border bg-background dark:bg-transparent">
          <Button
            variant="ghost"
            size={compact ? 'xs' : 'lg'}
            onClick={copy}
            className={compact ? 'rounded-r-none pr-2' : 'rounded-r-none pr-3'}
          >
            {/* Both labels sit in the one grid cell, so the pill is as wide as the longer of them and
              does not resize under the cursor for the second and a half the confirmation lasts. */}
            <span className="grid text-center">
              <span className={`col-start-1 row-start-1 ${copied ? 'invisible' : ''}`}>
                {label}
              </span>
              <span aria-hidden={!copied} className="col-start-1 row-start-1 aria-hidden:invisible">
                Prompt copied
              </span>
            </span>
            {/* The marks are all that says this is for an agent, so they stay at every width. */}
            <span
              className={`flex items-center text-muted-foreground transition-colors group-hover/button:text-foreground ${compact ? 'gap-1 [&_svg]:size-3' : 'gap-1.5'}`}
            >
              <ClaudeMark />
              <CodexMark />
              <CursorMark />
            </span>
          </Button>
          <span aria-hidden="true" className={`w-px bg-border ${compact ? 'h-3' : 'h-5'}`} />
          {compact ? <PopoverTrigger render={previewButton} /> : previewButton}
        </div>
        {compact ? (
          <PopoverContent id={panelId} align="start" className="w-[min(32rem,calc(100vw-2rem))]">
            <AgentPromptPreview prompt={prompt} copied={copied} onCopy={copy} />
          </PopoverContent>
        ) : reading ? (
          <div
            id={panelId}
            className="fade-in-0 slide-in-from-top-1 flex w-full animate-in flex-col items-center gap-3 rounded-2xl border bg-card/70 p-4 shadow-sm backdrop-blur-sm duration-200"
          >
            <AgentPromptPreview prompt={prompt} copied={copied} onCopy={copy} />
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
