import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { FolderXIcon } from 'lucide-react';

/**
 * One panel for every state that cannot answer a browse, because the sentence saying which state
 * it is in comes from the table rather than from here — including, for a release that never came
 * up, the host's own account of why, which is what turns "no files here" into something to fix.
 */
export function UnreadableFilesystem({ reason }: { reason: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderXIcon />
        </EmptyMedia>
        <EmptyTitle>These files cannot be read</EmptyTitle>
        <EmptyDescription>{reason}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
