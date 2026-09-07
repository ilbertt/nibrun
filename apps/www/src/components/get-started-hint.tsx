import { GITHUB_REPO_SLUG } from '@repo/global-constants';
import { CopyableLine } from '@repo/ui/custom/copyable-line';

const SKILL_COMMAND = `npx skills add ${GITHUB_REPO_SLUG}`;

export function GetStartedHint() {
  return (
    <div className="flex w-full flex-col items-center gap-2 text-muted-foreground text-xs">
      <p>Alternatively, deploy your own app</p>
      <CopyableLine value={SKILL_COMMAND} prompt />
    </div>
  );
}
