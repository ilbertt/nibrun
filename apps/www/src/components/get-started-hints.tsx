import { SITE_URL } from '#lib/site-url.ts';

const SKILL_COMMAND = 'npx skills add ilbertt/nibrun';
const CLI_INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;

export function GetStartedHints() {
  return (
    <div className="flex flex-col items-center gap-2">
      <CommandHint label="Point your agent to the skill to get started" command={SKILL_COMMAND} />
      <CommandHint label="Want the CLI? Install it with" command={CLI_INSTALL_COMMAND} />
    </div>
  );
}

function CommandHint({ label, command }: { label: string; command: string }) {
  return (
    <p className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-muted-foreground text-sm">
      <span>{label}</span>
      <code className="max-w-full rounded-md border bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs">
        {command}
      </code>
    </p>
  );
}
