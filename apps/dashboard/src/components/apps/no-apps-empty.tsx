import { CLI_INSTALL_COMMAND } from '@repo/global-constants';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { CopyableLine } from '@repo/ui/custom/copyable-line';
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
          <CopyableLine value={CLI_INSTALL_COMMAND} prompt />
        </div>
      </EmptyContent>
    </Empty>
  );
}
