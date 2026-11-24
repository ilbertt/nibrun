import { Button } from '@repo/ui/components/button';
import { PaidBucketRequestDialog } from '#components/apps/paid-bucket-request-dialog.tsx';
import { BucketIcon } from '#icons/bucket-icon.tsx';
import type { AppSummary } from '#queries/apps.ts';

export function AppVolume({ storage }: { storage: AppSummary['volumeStorage'] }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">Volume</span>
      {storage ? (
        <span className="break-all font-mono">{`s3://${storage.bucket}/${storage.prefix}`}</span>
      ) : (
        <PaidBucketRequestDialog
          trigger={
            <Button variant="outline" size="xs">
              <BucketIcon data-icon="inline-start" />
              Use your bucket
            </Button>
          }
        />
      )}
    </div>
  );
}
