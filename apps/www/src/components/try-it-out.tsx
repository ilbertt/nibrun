import { DEPLOY_PRESET_SLUGS } from '@repo/deploy-link';
import { WWW_DEPLOY_PATH } from '@repo/global-constants';
import { AgentPrompt } from '@repo/ui/custom/agent-prompt';
import { DeployPresetRoller } from '@repo/ui/custom/deploy-preset-roller';

export function TryItOut() {
  return (
    <section className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <h2 className="text-muted-foreground text-sm">Try it out</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {/* The short link the README hands out, not the deploy it expands to: this is an address
          somebody reads off the status bar and sends on, and the worker knows what it stands for. */}
      <DeployPresetRoller
        presets={DEPLOY_PRESET_SLUGS}
        // biome-ignore lint/a11y/useAnchorContent: the button renders as this anchor and is what puts a label inside it
        linkToPreset={(preset) => <a href={`${WWW_DEPLOY_PATH}/${preset}`} />}
      />
      <p className="text-muted-foreground text-sm">Or</p>
      <AgentPrompt />
    </section>
  );
}
