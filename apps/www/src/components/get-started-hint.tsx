import { GITHUB_REPO_SLUG } from '@repo/global-constants';
import { CopyButton } from '@repo/ui/custom/copy-button';

const SKILL_COMMAND = `npx skills add ${GITHUB_REPO_SLUG}`;

/**
 * The one line on this page you are meant to type, so it is dressed as the place you would type
 * it: a prompt in front and a caret waiting at the end.
 *
 * Both are `aria-hidden` and outside the copied string — a prompt pasted into a shell is a syntax
 * error, and the copy button carries the command on its own.
 */
export function GetStartedHint() {
  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
      <p>Alternatively, deploy your own app</p>
      <span className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted py-0.5 pr-0.5 pl-2">
        <span aria-hidden="true" className="select-none font-mono text-primary">
          $
        </span>
        <code className="min-w-0 font-mono text-foreground">{SKILL_COMMAND}</code>
        <span
          aria-hidden="true"
          className="inline-block h-3 w-1.5 shrink-0 bg-primary motion-safe:animate-caret"
        />
        <CopyButton value={SKILL_COMMAND} />
      </span>
    </div>
  );
}
