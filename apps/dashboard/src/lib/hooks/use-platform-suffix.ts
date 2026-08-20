import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

/**
 * What a brought domain is pointed at: the domain the app's own hostname sits under, which
 * already resolves to the fleet.
 *
 * Read off the app rather than configured here, so the dashboard holds no copy of a domain the
 * deployment owns and a deployment served under a different one needs no build of its own.
 */
export function usePlatformSuffix(): string {
  const app = useApp(useAppId());
  const platform = app.data?.hostnames.find((each) => each.kind === 'platform');

  return platform?.hostname.split('.').slice(1).join('.') ?? '';
}
