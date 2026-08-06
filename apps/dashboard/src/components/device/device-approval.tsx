import { DeviceCard } from '#components/device/device-card.tsx';
import { Button } from '#components/ui/button.tsx';
import { Field, FieldError } from '#components/ui/field.tsx';
import { useDeviceCode } from '#lib/hooks/use-device-code.ts';
import { useDeviceDecision } from '#lib/hooks/use-device-decision.ts';
import { useSession } from '#lib/hooks/use-session.ts';

export function DeviceApproval({ userCode }: { userCode: string }) {
  const session = useSession();
  const code = useDeviceCode(userCode);
  const decide = useDeviceDecision(userCode);

  if (code.status === 'checking') {
    return <DeviceCard title="Sign in a terminal" description="Checking that code…" />;
  }

  if (code.status === 'refused') {
    return <DeviceCard failed title="Sign in failed" description={code.reason} />;
  }

  if (decide.isSuccess) {
    return decide.variables === 'approve' ? (
      <DeviceCard title="Signed in" description="You can close this page." />
    ) : (
      <DeviceCard
        title="Sign in refused"
        description="Nothing was signed in. You can close this page."
      />
    );
  }

  return (
    <DeviceCard
      title="Sign in a terminal"
      description="Check the code matches the one it showed you."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">A terminal is asking to sign in as</p>
          <p className="truncate font-semibold">{session?.user.email}</p>
        </div>
        <p className="rounded-md bg-muted py-3 text-center font-mono text-xl tracking-widest">
          {userCode}
        </p>
        <p className="text-muted-foreground text-sm">
          Approve only if you just started this from a terminal you trust. It will be able to deploy
          and delete your apps.
        </p>
        <Field data-invalid={decide.isError || undefined}>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate('deny')}
            >
              Refuse
            </Button>
            <Button
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate('approve')}
            >
              {decide.isPending ? 'Working…' : 'Approve'}
            </Button>
          </div>
          {decide.isError && <FieldError>{decide.error.message}</FieldError>}
        </Field>
      </div>
    </DeviceCard>
  );
}
