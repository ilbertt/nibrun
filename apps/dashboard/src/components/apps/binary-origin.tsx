import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { GlobeIcon, UploadIcon } from 'lucide-react';
import type { ArtifactSummary } from '#queries/artifacts.ts';

export function BinaryOrigin({
  originalFileUrl,
}: {
  originalFileUrl: ArtifactSummary['originalFileUrl'];
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          originalFileUrl === undefined ? (
            <button type="button" aria-label="Uploaded binary">
              <UploadIcon className="size-3" aria-hidden="true" />
            </button>
          ) : (
            <a
              href={originalFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Binary source: ${originalFileUrl}`}
            >
              <GlobeIcon className="size-3" aria-hidden="true" />
            </a>
          )
        }
        className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
      />
      <TooltipContent className="break-all">{originalFileUrl ?? 'Uploaded binary'}</TooltipContent>
    </Tooltip>
  );
}
