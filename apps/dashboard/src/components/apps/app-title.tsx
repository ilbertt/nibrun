import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function AppTitle() {
  const appId = useAppId();
  const app = useApp(appId);

  return <h1 className="font-medium font-mono text-base">{app.data?.slug ?? appId}</h1>;
}
