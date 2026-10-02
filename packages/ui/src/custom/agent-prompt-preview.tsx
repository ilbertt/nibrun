import { Button } from '@repo/ui/components/button';
import { CheckIcon, CopyIcon } from 'lucide-react';

export function AgentPromptPreview({
  prompt,
  copied,
  onCopy,
}: {
  prompt: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <p className="whitespace-pre-wrap text-pretty break-words text-center text-sm leading-relaxed">
        {prompt}
      </p>
      <Button variant="outline" size="sm" onClick={onCopy} className="self-center">
        {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
        {copied ? 'Copied' : 'Copy prompt'}
      </Button>
    </>
  );
}
