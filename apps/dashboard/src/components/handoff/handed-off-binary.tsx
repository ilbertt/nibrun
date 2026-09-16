import { BrandMark } from '@repo/ui/custom/brand-mark';
import { HandoffDeploy } from '#components/handoff/handoff-deploy.tsx';
import { OpenSourceFooter } from '#components/handoff/open-source-footer.tsx';
import { discardHandedOffBinary } from '#lib/handoff-store.ts';
import { useHandedOffBinary } from '#lib/hooks/use-handed-off-binary.ts';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';
import { WWW_ORIGIN } from '#lib/www-origin.ts';

/**
 * A binary handed over from the landing page is a head start, not a precondition: the form
 * carries a picker of its own, so an owner who arrived with nothing still has everything they
 * need to deploy — which is why there is no empty state to land in. Nor is a session one: a
 * visitor with none becomes a stranger the moment they deploy.
 */
export function HandedOffBinary() {
  const binary = useHandedOffBinary();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <a className="transition-opacity hover:opacity-80" href={WWW_ORIGIN}>
        <BrandMark />
      </a>
      <div className="flex w-full max-w-lg flex-col gap-6 lg:max-w-3xl">
        {/* The drop is spent the moment it lands, and what is left of it is megabytes of
            somebody's storage held against a deploy that already happened. */}
        <DeployRunProvider onDeployed={discardHandedOffBinary}>
          <HandoffDeploy binary={binary} />
        </DeployRunProvider>
      </div>
      <OpenSourceFooter />
    </div>
  );
}
