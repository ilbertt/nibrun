import { Button } from '@repo/ui/components/button';
import { useStore } from '@tanstack/react-form';
import { ConfigureDeployment } from '#components/apps/configure-deployment.tsx';
import { DeployBinaryField } from '#components/apps/deploy-binary-field.tsx';
import { asksForVariables, DeployConfiguration } from '#components/apps/deploy-configuration.tsx';
import { MinimalBinaryField } from '#components/apps/minimal-binary-field.tsx';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import { useDeployForm } from '#lib/hooks/use-deploy-form.ts';

export function DeployForm({
  appId,
  binary,
  suggested,
  minimal = false,
}: {
  appId: string | undefined;
  binary: File | undefined;
  suggested?: DeploySuggestion | undefined;
  minimal?: boolean | undefined;
}) {
  const form = useDeployForm({ appId, binary, suggested });
  const { api, locked, replacing, targetResolved } = form;
  const picked = useStore(api.store, (state) => state.values.binary !== undefined);
  // One form either way, so the binary survives the way out of the stripped one.
  const stripped = minimal && !asksForVariables(suggested);

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      {stripped ? (
        <MinimalBinaryField api={api} appName={suggested?.name} />
      ) : (
        <DeployBinaryField api={api} replacing={replacing} />
      )}

      {stripped ? (
        <ConfigureDeployment />
      ) : (
        <DeployConfiguration form={form} suggested={suggested} />
      )}

      {replacing !== undefined && (
        <p className="wrap-anywhere rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          This restarts <span className="font-medium font-mono">{replacing.slug}</span>
          {picked ? ' on the binary above' : ' on the binary it already runs'}. Its hostnames and
          everything on its volume stay as they are.
        </p>
      )}

      <api.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" size="lg" disabled={!canSubmit || !targetResolved}>
            <span className="truncate">
              {submitLabel({ replacing: replacing?.slug, locked, picked })}
            </span>
          </Button>
        )}
      </api.Subscribe>
    </form>
  );
}

function submitLabel({
  replacing,
  locked,
  picked,
}: {
  replacing: string | undefined;
  locked: boolean;
  picked: boolean;
}): string {
  if (replacing !== undefined) {
    return picked ? `Replace what ${replacing} runs` : `Redeploy ${replacing}`;
  }
  return locked ? 'Reading the app…' : 'Create the app and deploy';
}
