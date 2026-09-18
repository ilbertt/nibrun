import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import type { ArtifactSummary } from '#queries/artifacts.ts';

// Docker's abbreviation of a SHA-256: enough to tell two binaries apart at a glance, short enough
// to sit beside the name. The whole digest is a hover away, and a click is what hands it over.
const SHORT_DIGEST_LENGTH = 12;

export function BinaryLabel({ artifact }: { artifact: ArtifactSummary }) {
  const { copied, copy } = useClipboardCopy(artifact.digest);

  return (
    <>
      {artifact.originalFileName}{' '}
      <span className="text-muted-foreground">
        (
        <Tooltip>
          <TooltipTrigger closeOnClick={false} onClick={copy} className="cursor-pointer">
            sha256:{artifact.digest.slice(0, SHORT_DIGEST_LENGTH)}
          </TooltipTrigger>
          <TooltipContent className="break-all font-mono">
            {copied ? 'Copied' : artifact.digest}
          </TooltipContent>
        </Tooltip>
        )
      </span>
    </>
  );
}
