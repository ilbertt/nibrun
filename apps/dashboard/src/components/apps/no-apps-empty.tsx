import { CLI_INSTALL_COMMAND } from '@repo/global-constants';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { BoxIcon } from 'lucide-react';
import { DeployDialog } from '#components/deploy/deploy-dialog.tsx';

export function NoAppsEmpty() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>You have no apps</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <DeployDialog />
        <div className="flex w-full flex-col gap-2">
          <p className="text-muted-foreground">Alternatively, use the CLI:</p>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
            <code className="flex-1 select-all break-words text-left font-mono text-xs">
              {CLI_INSTALL_COMMAND}
            </code>
            <CopyButton value={CLI_INSTALL_COMMAND} />
          </div>
        </div>
      </EmptyContent>
    </Empty>
  );
}
