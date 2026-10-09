import { Badge } from '@repo/ui/components/badge';
import { SparklesIcon } from 'lucide-react';

export function RecommendedBadge({ iconOnly }: { iconOnly: boolean }) {
  return (
    <Badge
      variant="outline"
      title="Recommended"
      className={iconOnly ? 'size-5 border-0 p-0 text-primary' : 'border-primary/30 text-primary'}
    >
      <SparklesIcon aria-hidden="true" />
      <span className={iconOnly ? 'sr-only' : undefined}>Recommended</span>
    </Badge>
  );
}
