import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { DialogBody } from '@repo/ui/custom/dialog-body';
import { Link, useLocation } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { PaidAlwaysOnRequestForm } from '#components/apps/paid-always-on-request-form.tsx';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function PaidAlwaysOnRequestDialog({ trigger }: { trigger: ReactElement }) {
  const identity = useSessionIdentity();
  const here = useLocation({ select: (location) => location.href });

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Want to keep this app always on?</DialogTitle>
          <DialogDescription>
            Keep this app running between requests, without stopping when idle. This is an upcoming
            paid feature. Send a request to let us know you’re interested.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Sending a request does not enable the feature or charge you.
          </p>
          {identity === SessionIdentity.WithAccount ? (
            <PaidAlwaysOnRequestForm />
          ) : (
            <Button render={<Link to="/login" search={{ redirect: here }} />}>
              Sign in to send a request
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
