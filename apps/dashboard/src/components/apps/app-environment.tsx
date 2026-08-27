import { AppEnvironmentDialog } from '#components/apps/app-environment-dialog.tsx';
import { storedNames } from '#lib/environment-variables.ts';
import type { AppSummary } from '#queries/apps.ts';

// Enough to recognise the app by what it is configured with. The rest are a count, because a card
// that grows with the environment is one that pushes everything under it off the screen.
const NAMES_SHOWN = 5;

/** Which variables the app runs with. The values are sealed, so the names are the whole of it. */
export function AppEnvironment({ app }: { app: AppSummary }) {
  const names = storedNames(app);
  const beyond = names.length - NAMES_SHOWN;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Environment variables</span>
        <AppEnvironmentDialog app={app} />
      </div>
      {names.length === 0 ? (
        <span className="text-muted-foreground">
          Nothing set — the binary runs with whatever the guest gives it.
        </span>
      ) : (
        <ul className="flex flex-wrap items-center gap-1">
          {names.slice(0, NAMES_SHOWN).map((name) => (
            <li key={name} className="rounded-md bg-muted px-2 py-0.5 font-mono">
              {name}
            </li>
          ))}
          {beyond > 0 && <li className="text-muted-foreground">+{beyond} more</li>}
        </ul>
      )}
    </div>
  );
}
