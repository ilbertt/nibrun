import type { DeploySuggestion } from '@repo/deploy-link';
import { Button } from '@repo/ui/components/button';
import { useStore } from '@tanstack/react-form';
import { AdvancedConfiguration } from '#components/deploy/advanced-configuration.tsx';
import { DeployBinaryField } from '#components/deploy/deploy-binary-field.tsx';
import { asksForVariables, DeployConfiguration } from '#components/deploy/deploy-configuration.tsx';
import { MinimalBinaryField } from '#components/deploy/minimal-binary-field.tsx';
import { binaryName } from '#lib/binary-source.ts';
import { type DeployFormValues, useDeployForm } from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

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
  const { api, replacing, targetResolved } = form;
  const picked = useStore(api.store, (state) => state.values.binary !== undefined);
  const appName = useStore(api.store, (state) => deployedName({ values: state.values, replacing }));
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
        <MinimalBinaryField form={form} appName={suggested?.name} />
      ) : (
        <DeployBinaryField form={form} />
      )}

      {!stripped && <DeployConfiguration form={form} suggested={suggested} />}

      {replacing !== undefined && (
        <p className="wrap-anywhere rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          This restarts <span className="font-medium font-mono">{replacing.slug}</span>
          {picked ? ' on the binary above' : ' on the binary it already runs'}. Its hostnames and
          everything on its volume stay as they are.
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <api.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button type="submit" size="lg" disabled={!canSubmit || !targetResolved}>
              <span className="truncate">{submitLabel({ appName, targetResolved })}</span>
            </Button>
          )}
        </api.Subscribe>
        {stripped && <AdvancedConfiguration />}
      </div>
    </form>
  );
}

/**
 * The app this deploys, as it is known right now: the one being released again, the name that was
 * typed or asked for, or the binary the app would be named after. Whichever it is, the button says
 * it as soon as the form knows it.
 */
function deployedName({
  values,
  replacing,
}: {
  values: DeployFormValues;
  replacing: AppSummary | undefined;
}): string | undefined {
  if (replacing !== undefined) {
    return replacing.slug;
  }
  const typed = values.name.trim();
  // Whichever way the binary was given: the file that was picked, or the file the url ends in.
  return typed === '' ? binaryName(values.binary) : typed;
}

function submitLabel({
  appName,
  targetResolved,
}: {
  appName: string | undefined;
  targetResolved: boolean;
}): string {
  if (!targetResolved) {
    return 'Reading the app…';
  }
  return appName === undefined ? 'Deploy the app' : `Deploy ${appName}`;
}
