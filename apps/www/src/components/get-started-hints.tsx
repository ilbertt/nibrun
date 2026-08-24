import { SITE_URL } from '#lib/site-url.ts';

const SKILL_COMMAND = 'npx skills add ilbertt/nibrun';
const CLI_INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;

export function GetStartedHints() {
  return (
    <div className="flex flex-col items-center gap-1.5 text-muted-foreground text-xs">
      <p>Alternatively, deploy your own app by</p>
      <CommandHint label="adding the skill" command={SKILL_COMMAND} />
      <CommandHint label="or installing the CLI" command={CLI_INSTALL_COMMAND} />
    </div>
  );
}

function CommandHint({ label, command }: { label: string; command: string }) {
  return (
    <p className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
      <span>{label}</span>
      {/* A notch under the line around it: at the inherited size the install command wraps on a
          narrow phone, and a lone `sh` on the second line reads like a typo. */}
      <code className="max-w-full rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground">
        {command}
      </code>
    </p>
  );
}
