import { Button } from '@repo/ui/components/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useClipboardCopy } from '#lib/hooks/use-clipboard-copy.ts';

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
