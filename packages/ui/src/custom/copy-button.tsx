import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, CopyIcon } from 'lucide-react';

export function CopyButton({ value }: { value: string }) {
  const { copied, copy } = useClipboardCopy(value);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
