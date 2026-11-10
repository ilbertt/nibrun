import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { InfoIcon } from 'lucide-react';

const LABEL = 'Automatic maintenance deployment';

export function SystemDeploymentOrigin() {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex cursor-help items-center text-muted-foreground"
        aria-label={LABEL}
      >
        <InfoIcon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{LABEL}</TooltipContent>
    </Tooltip>
  );
}
