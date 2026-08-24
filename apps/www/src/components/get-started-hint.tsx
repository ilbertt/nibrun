import { CopyButton } from '@repo/ui/custom/copy-button';

const SKILL_COMMAND = 'npx skills add ilbertt/nibrun';

export function GetStartedHint() {
  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
      <p>Alternatively, deploy your own app</p>
      <span className="flex max-w-full items-center gap-0.5 rounded-md border bg-muted py-0.5 pr-0.5 pl-1.5">
        <code className="min-w-0 font-mono text-foreground">{SKILL_COMMAND}</code>
        <CopyButton value={SKILL_COMMAND} />
      </span>
    </div>
  );
}
