import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { BoxIcon } from 'lucide-react';
import { DeployDialog } from '#components/apps/deploy-dialog.tsx';

const INSTALL_COMMAND = 'curl -fsSL https://nibrun.com/install.sh | sh';

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
              {INSTALL_COMMAND}
            </code>
            <CopyButton value={INSTALL_COMMAND} />
          </div>
        </div>
      </EmptyContent>
    </Empty>
  );
}
