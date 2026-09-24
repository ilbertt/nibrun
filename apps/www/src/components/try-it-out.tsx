import { DEPLOY_PRESET_SLUGS } from '@repo/deploy-link';
import { AgentPrompt } from '@repo/ui/custom/agent-prompt';
import { DeployPresetRoller } from '@repo/ui/custom/deploy-preset-roller';
import { Link } from '@tanstack/react-router';

export function TryItOut() {
  return (
    <section className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <h2 className="text-muted-foreground text-sm">Try it out</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {/* The catalog rather than the name that happens to be showing, and no list behind a
          chevron: the page the key opens is the list, with what each one is written beside it. */}
      <DeployPresetRoller
        presets={DEPLOY_PRESET_SLUGS}
        linkToShown={() => <Link to="/apps" search={{ category: undefined }} />}
        linkToPreset={undefined}
      />
      <p className="text-muted-foreground text-sm">Or</p>
      <AgentPrompt />
    </section>
  );
}
