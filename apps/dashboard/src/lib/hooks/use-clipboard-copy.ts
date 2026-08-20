import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const CONFIRMATION_MS = 1500;

export type ClipboardCopy = { copied: boolean; copy: () => void };

/**
 * A clipboard write is silent, so what is worth holding is that it happened: `copied` is what a
 * caller shows back, and it lapses on its own so nothing has to clear it.
 */
export function useClipboardCopy(value: string): ClipboardCopy {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const lapse = setTimeout(() => setCopied(false), CONFIRMATION_MS);
    return () => clearTimeout(lapse);
  }, [copied]);

  return {
    copied,
    copy: () => {
      void navigator.clipboard.writeText(value).then(
        () => setCopied(true),
        // Denied, or a page served over plain http. Said out loud rather than left as a button
        // that does nothing — the text it would have copied is selectable either way.
        () => toast.error('Could not reach the clipboard. Select the text and copy it.'),
      );
    },
  };
}
