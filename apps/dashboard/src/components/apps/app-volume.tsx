import { Button } from '@repo/ui/components/button';
import { PaidBucketRequestDialog } from '#components/apps/paid-bucket-request-dialog.tsx';

export function AppVolume() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Volume</span>
        <PaidBucketRequestDialog
          trigger={
            <Button variant="outline" size="xs">
              Use your bucket
            </Button>
          }
        />
      </div>
      <span className="text-muted-foreground">Your app’s persistent data.</span>
    </div>
  );
}
