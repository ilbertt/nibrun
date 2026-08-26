import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { TriangleAlertIcon } from 'lucide-react';

/**
 * The release's own account of why it never came up is repeated verbatim: it names the port
 * nothing answered on and how long it was given, which is the whole of what turns "no files here"
 * into something an owner can fix.
 */
export function UnreadableFilesystem({ reason }: { reason: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>This app is not running</EmptyTitle>
        <EmptyDescription>
          Its files are read from inside the microVM that has them mounted, and a release that
          failed never got one. Nothing has left the volume — deploy again to browse it.
        </EmptyDescription>
        <EmptyDescription className="font-mono text-xs">{reason}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
