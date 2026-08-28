import { Button } from '@repo/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@repo/ui/components/empty';
import { Spinner } from '@repo/ui/components/spinner';
import { BrandMark } from '@repo/ui/custom/brand-mark';
import { Link, useLocation } from '@tanstack/react-router';
import { FileTerminalIcon } from 'lucide-react';
import { HandoffDeploy } from '#components/handoff/handoff-deploy.tsx';
import { namedByUrl } from '#lib/binary-source.ts';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import { formatBytes } from '#lib/format-bytes.ts';
import { useFinishHandoff } from '#lib/hooks/use-finish-handoff.ts';
import { useHandedOffBinary } from '#lib/hooks/use-handed-off-binary.ts';
import { useSession } from '#lib/hooks/use-session.ts';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';

export function HandedOffBinary({ suggested }: { suggested?: DeploySuggestion | undefined }) {
  const { binary, loading } = useHandedOffBinary();
  const session = useSession();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <BrandMark />
      <div className="flex w-full max-w-lg flex-col gap-6 lg:max-w-3xl">
        {loading ? (
          <Spinner />
        ) : (
          <Waiting binary={binary} signedIn={session !== null} suggested={suggested} />
        )}
      </div>
    </div>
  );
}

/**
 * A binary handed over from the landing page is a head start, not a precondition: the form
 * carries a picker of its own, so an owner who arrived with nothing still has everything they
 * need to deploy — which is why there is no empty state to land in.
 */
function Waiting({
  binary,
  signedIn,
  suggested,
}: {
  binary: File | undefined;
  signedIn: boolean;
  suggested: DeploySuggestion | undefined;
}) {
  const finishHandoff = useFinishHandoff();
  // What is already known about what will be deployed, so signing in is not asked for on faith.
  const named = binary?.name ?? namedByUrl(suggested?.binary ?? '');
  // Whatever was handed over or asked for has to survive the trip through the login form, or
  // signing in is what loses it.
  const here = useLocation({ select: (location) => location.href });

  // The form asks the api what the owner already has, so there is nothing to render until
  // there is an owner.
  if (!signedIn) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTerminalIcon />
          </EmptyMedia>
          <EmptyTitle className={named === undefined ? undefined : 'break-all font-mono'}>
            {named ?? 'Deploy a binary'}
          </EmptyTitle>
          <EmptyDescription>{describeWaiting({ binary, suggested })}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to={LoginRoute.to} search={{ redirect: here }} />}>
            Sign in to deploy it
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <DeployRunProvider onDeployed={finishHandoff}>
      <HandoffDeploy binary={binary} suggested={suggested} />
    </DeployRunProvider>
  );
}

function describeWaiting({
  binary,
  suggested,
}: {
  binary: File | undefined;
  suggested: DeploySuggestion | undefined;
}): string {
  if (binary !== undefined) {
    return `${formatBytes(binary.size)}, waiting to be deployed.`;
  }
  return suggested?.binary === undefined
    ? 'Sign in, then pick the binary you compiled.'
    : 'Sign in, and nibrun fetches it from the url this link named.';
}
