import { useState } from 'react';
import { toast } from 'sonner';

export type Clipboard = {
  readonly copied: boolean;
  readonly copy: () => void;
  readonly forget: () => void;
};

/**
 * `copied` holds until the caller says to forget it, rather than for a timer's worth: what it
 * confirms is the click just made, and the moment that stops being current — the pointer leaving,
 * a tooltip closing — is the caller's to know.
 */
export function useClipboard(text: string): Clipboard {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => toast.error('Could not copy to the clipboard'),
    );
  }

  function forget(): void {
    setCopied(false);
  }

  return { copied, copy, forget };
}
