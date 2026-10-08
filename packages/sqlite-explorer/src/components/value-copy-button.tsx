import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, CopyIcon } from 'lucide-react';

export function ValueCopyButton({
  value,
  label,
  iconOnly,
}: {
  value: string;
  label: string;
  iconOnly: boolean;
}) {
  const { copied, copy } = useClipboardCopy({ value, onCopied: undefined });

  return (
    <Button
      variant={iconOnly ? 'ghost' : 'outline'}
      size={iconOnly ? 'icon-xs' : 'sm'}
      aria-label={copied ? `${label}: copied` : label}
      onClick={copy}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {iconOnly ? null : copied ? 'Copied' : label}
    </Button>
  );
}
