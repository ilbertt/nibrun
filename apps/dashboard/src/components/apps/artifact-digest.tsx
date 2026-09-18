import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';

// Docker's abbreviation of a SHA-256: enough to tell two binaries apart at a glance, short enough
// for a table cell. The whole digest is a hover away, and a click is what hands it over.
const SHORT_DIGEST_LENGTH = 12;

export function ArtifactDigest({ digest }: { digest: string }) {
  const { copied, copy } = useClipboardCopy(digest);

  return (
    <Tooltip>
      <TooltipTrigger closeOnClick={false} onClick={copy} className="cursor-copy">
        {digest.slice(0, SHORT_DIGEST_LENGTH)}
      </TooltipTrigger>
      <TooltipContent className="break-all font-mono">{copied ? 'Copied' : digest}</TooltipContent>
    </Tooltip>
  );
}
