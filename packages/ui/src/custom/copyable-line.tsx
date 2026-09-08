import { CopyButton } from '@repo/ui/custom/copy-button';

/**
 * One line of machine text with a button to take it away: a command to run, an address to dial.
 *
 * Clicking the text selects all of it, because half a command is worse than none — the copy button
 * is for people who saw it, and the selection is for people who reached for the mouse first.
 */
export function CopyableLine({
  value,
  prompt,
}: {
  value: string;
  /**
   * For a line someone is meant to type, as against one that is only reported — a run command
   * belongs to the guest and an address is dialled by something else.
   *
   * Drawn rather than part of `value`: a prompt pasted into a shell is a syntax error.
   */
  prompt: boolean;
}) {
  return (
    <span className="code-surface flex items-center gap-2 py-1 pr-1 pl-2.5">
      {prompt && (
        <span aria-hidden="true" className="select-none font-mono text-primary text-xs">
          $
        </span>
      )}
      <code className="min-w-0 flex-1 select-all break-words text-left font-mono text-xs">
        {value}
      </code>
      <CopyButton value={value} />
    </span>
  );
}
