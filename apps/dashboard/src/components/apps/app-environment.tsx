import { AppEnvironmentDialog } from '#components/apps/app-environment-dialog.tsx';
import { storedNames } from '#lib/environment-variables.ts';
import type { AppSummary } from '#queries/apps.ts';

/** Which variables the app runs with. The values are sealed, so the names are the whole of it. */
export function AppEnvironment({ app }: { app: AppSummary }) {
  const names = storedNames(app);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Environment</span>
        <AppEnvironmentDialog app={app} />
      </div>
      {names.length === 0 ? (
        <span className="text-muted-foreground">
          Nothing set — the binary runs with whatever the guest gives it.
        </span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {names.map((name) => (
            <li key={name} className="rounded-md bg-muted px-2 py-0.5 font-mono">
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
