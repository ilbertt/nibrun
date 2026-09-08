import { DEPLOY_PRESET_SLUGS, DEPLOY_PRESETS } from '@repo/deploy-link';
import { CLI_INSTALL_COMMAND } from '@repo/global-constants';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { AgentPrompt } from '@repo/ui/custom/agent-prompt';
import { CopyableLine } from '@repo/ui/custom/copyable-line';
import { DeployPresetRoller } from '@repo/ui/custom/deploy-preset-roller';
import { Link } from '@tanstack/react-router';
import { BoxIcon } from 'lucide-react';
import { DeployDialog } from '#components/deploy/deploy-dialog.tsx';
import { ENABLED } from '#lib/app-actions.ts';
import { Route as DeployRoute } from '#routes/deploy.tsx';

export function NoAppsEmpty() {
  return (
    <Empty className="border p-6 sm:p-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>You have no apps</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <DeployDialog appId={undefined} availability={ENABLED} />
        <p className="text-muted-foreground">Or</p>
        <DeployPresetRoller
          presets={DEPLOY_PRESET_SLUGS}
          linkToPreset={(preset) => <Link to={DeployRoute.to} search={DEPLOY_PRESETS[preset]} />}
        />
        <p className="text-muted-foreground">Or</p>
        <AgentPrompt />
        <div className="flex w-full flex-col gap-2">
          <p className="text-muted-foreground">Or use the CLI to deploy your app</p>
          <CopyableLine value={CLI_INSTALL_COMMAND} prompt />
        </div>
      </EmptyContent>
    </Empty>
  );
}
