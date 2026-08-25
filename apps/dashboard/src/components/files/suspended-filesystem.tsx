import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { PauseIcon } from 'lucide-react';

export function SuspendedFilesystem() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PauseIcon />
        </EmptyMedia>
        <EmptyTitle>This app is suspended</EmptyTitle>
        <EmptyDescription>
          Its files are read from inside the microVM that has them mounted, and a suspended app has
          none running. Nothing has left the volume — resume the app to browse it again.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
