import { Button } from '@repo/ui/components/button';
import { Link, useLocation } from '@tanstack/react-router';
import { PaidAppsRequestForm } from '#components/deploy/paid-apps-request-form.tsx';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function AppLimitReached({ appsAllowed }: { appsAllowed: number }) {
  const identity = useSessionIdentity();
  const here = useLocation({ select: (location) => location.href });

  return (
    <section className="flex flex-col gap-4 rounded-2xl border p-4" aria-label="App limit reached">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Paid apps are coming</p>
        <p className="text-muted-foreground text-sm">
          You’ve reached your limit of {appsAllowed} app{appsAllowed === 1 ? '' : 's'}.
        </p>
      </div>
      {identity === SessionIdentity.WithAccount ? (
        <PaidAppsRequestForm />
      ) : (
        <Button render={<Link to="/login" search={{ redirect: here }} />}>
          Sign in to request more apps
        </Button>
      )}
    </section>
  );
}
