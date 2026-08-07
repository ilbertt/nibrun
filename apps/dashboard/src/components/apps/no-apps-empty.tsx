import { BoxIcon } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty.tsx';

export function NoAppsEmpty() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>You have no apps</EmptyTitle>
        <EmptyDescription>
          <code className="font-mono">nib run</code> is what makes one.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
