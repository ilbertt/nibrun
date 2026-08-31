import { activationSummary } from '@repo/app-operations';
import type { AppSummary } from '#queries/apps.ts';

/**
 * How the app is brought up: kept running, or started by the request that needs it.
 *
 * Shown for every app rather than only the ones that sleep — an owner reading this card is asking
 * what their app does between requests, and `Always on` is an answer to that where a missing row
 * is a question about whether the page is stale.
 */
export function AppActivation({ app }: { app: AppSummary }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">Activation</span>
      <span>{activationSummary(app)}</span>
    </div>
  );
}
