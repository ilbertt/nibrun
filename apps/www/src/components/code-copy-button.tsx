import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, CopyIcon } from 'lucide-react';

// Not the shared CopyButton: that one reads the value into its own label, which for a whole
// snippet would hand a screen reader the snippet instead of the word for the action.
export function CodeCopyButton({ code }: { code: string }) {
  const { copied, copy } = useClipboardCopy(code);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : 'Copy code'}
      onClick={copy}
      // Opaque, because the code scrolls sideways underneath it rather than around it.
      className="absolute top-2 right-2 bg-muted"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
