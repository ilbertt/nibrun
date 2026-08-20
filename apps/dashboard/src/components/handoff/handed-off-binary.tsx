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
import { Link } from '@tanstack/react-router';
import { FileTerminalIcon, UploadIcon } from 'lucide-react';
import { HandoffDeploy } from '#components/handoff/handoff-deploy.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { useHandedOffBinary } from '#lib/hooks/use-handed-off-binary.ts';
import { useSession } from '#lib/hooks/use-session.ts';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as DeployRoute } from '#routes/deploy.tsx';

export function HandedOffBinary() {
  const { binary, loading } = useHandedOffBinary();
  const session = useSession();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <BrandMark />
      <div className="flex w-full max-w-lg flex-col gap-6">
        {loading ? <Spinner /> : <Waiting binary={binary} signedIn={session !== null} />}
      </div>
    </div>
  );
}

function Waiting({ binary, signedIn }: { binary: File | undefined; signedIn: boolean }) {
  if (binary === undefined) {
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
          <EmptyTitle className="break-all font-mono">{binary.name}</EmptyTitle>
          <EmptyDescription>{formatBytes(binary.size)}, waiting to be deployed.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to={LoginRoute.to} search={{ redirect: DeployRoute.to }} />}>
            Sign in to deploy it
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <DeployRunProvider>
      <HandoffDeploy binary={binary} />
    </DeployRunProvider>
  );
}
