import { HardDriveIcon, PackageIcon } from 'lucide-react';
import { Button } from '#components/ui/button.tsx';
import { Card } from '#components/ui/card.tsx';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty.tsx';

export function DeploymentCard() {
  return (
    <Card className="p-0">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon />
          </EmptyMedia>
          <EmptyTitle>No binary deployed</EmptyTitle>
          <EmptyDescription>
            Upload a compiled binary and nibrun runs it in an isolated guest with a persistent
            volume mounted at <code className="font-mono">data/</code>.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled>
            <HardDriveIcon />
            Upload binary
          </Button>
        </EmptyContent>
      </Empty>
    </Card>
  );
}
