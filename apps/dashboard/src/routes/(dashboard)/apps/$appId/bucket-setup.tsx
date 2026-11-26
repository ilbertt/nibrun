import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link, useLocation } from '@tanstack/react-router';
import { BucketSetupForm } from '#components/apps/bucket-setup-form.tsx';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export const Route = createFileRoute('/(dashboard)/apps/$appId/bucket-setup')({
  component: RouteComponent,
});

function RouteComponent() {
  const { appId } = Route.useParams();
  const identity = useSessionIdentity();
  const here = useLocation({ select: (location) => location.href });
  return (
    <section className="max-w-lg space-y-4">
      <h2 className="font-medium">Custom bucket setup</h2>
      {identity === SessionIdentity.WithAccount ? (
        <BucketSetupForm key={appId} />
      ) : (
        <Button render={<Link to="/login" search={{ redirect: here }} />}>
          Sign in to configure storage
        </Button>
      )}
    </section>
  );
}
