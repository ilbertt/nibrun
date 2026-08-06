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
    return <p className="text-muted-foreground text-sm">Checking that code…</p>;
  }

  if (code.status === 'refused') {
    return <FieldError>{code.reason}</FieldError>;
  }

  if (decide.isSuccess) {
    return (
      <p className="text-sm">
        {decide.variables === 'approve'
          ? 'Signed in. You can go back to your terminal.'
          : 'Refused. Nothing was signed in.'}
      </p>
    );
  }

  return (
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
  );
}
