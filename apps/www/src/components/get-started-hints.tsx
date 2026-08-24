import { LabeledDivider } from '#components/labeled-divider.tsx';
import { SITE_URL } from '#lib/site-url.ts';

const SKILL_COMMAND = 'npx skills add ilbertt/nibrun';
const CLI_INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;

export function GetStartedHints() {
  return (
    <div className="flex flex-col items-center gap-3 text-muted-foreground text-xs">
      <p>Alternatively, deploy your own app</p>
      {/* Two columns so both commands start at the same edge, one on a phone, where the label
          reads better stacked over a chip that already fills the width. */}
      <div className="grid justify-items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_auto] sm:justify-items-start">
        <span className="sm:justify-self-end">Add the skill</span>
        <Command>{SKILL_COMMAND}</Command>
        <div className="col-span-full justify-self-stretch py-1">
          <LabeledDivider>
            <span>or</span>
          </LabeledDivider>
        </div>
        <span className="sm:justify-self-end">Install the CLI</span>
        <Command>{CLI_INSTALL_COMMAND}</Command>
      </div>
    </div>
  );
}

// A notch under the line around it: at the inherited size the install command wraps on a narrow
// phone, and a lone `sh` on the second line reads like a typo.
function Command({ children }: { children: string }) {
  return (
    <code className="max-w-full rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground">
      {children}
    </code>
  );
}
