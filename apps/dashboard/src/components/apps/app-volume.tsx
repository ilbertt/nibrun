import { Button } from '@repo/ui/components/button';
import { PaidBucketRequestDialog } from '#components/apps/paid-bucket-request-dialog.tsx';
import { BucketIcon } from '#icons/bucket-icon.tsx';

export function AppVolume() {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">Volume</span>
      <PaidBucketRequestDialog
        trigger={
          <Button variant="outline" size="xs">
            <BucketIcon data-icon="inline-start" />
            Use your bucket
          </Button>
        }
      />
    </div>
  );
}
