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
import { FileTerminalIcon, UploadIcon } from 'lucide-react';
import { HandoffDeploy } from '#components/handoff/handoff-deploy.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import type { DeploySuggestion } from '#lib/hooks/use-deploy-form.ts';
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
  // Arriving from a "Deploy on nibrun" link is an errand of its own: nothing was handed over,
  // and the form's own picker is what the visitor came here to reach.
  const invited = suggested?.name !== undefined || suggested?.port !== undefined;
  // Whatever was asked for has to survive the trip through the login form, or signing in is
  // what loses it.
  const here = useLocation({ select: (location) => location.href });

  if (binary === undefined && !invited) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UploadIcon />
          </EmptyMedia>
          <EmptyTitle>No binary waiting</EmptyTitle>
          <EmptyDescription>Drop one on nibrun.com to bring it here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // The form asks the api what the owner already has, so there is nothing to render until
  // there is an owner.
  if (!signedIn) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTerminalIcon />
          </EmptyMedia>
          <EmptyTitle className={binary === undefined ? undefined : 'break-all font-mono'}>
            {binary?.name ?? 'Deploy a binary'}
          </EmptyTitle>
          <EmptyDescription>
            {binary === undefined
              ? 'Sign in, then pick the binary you compiled.'
              : `${formatBytes(binary.size)}, waiting to be deployed.`}
          </EmptyDescription>
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
