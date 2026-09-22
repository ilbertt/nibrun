import { DEFAULT_LOG_TIMERANGE, GUEST_PATH_ROOT } from '@repo/protocol';
import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { Link } from '@tanstack/react-router';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useAppTab } from '#lib/hooks/use-app-tab.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';
import { Route as DomainsRoute } from '#routes/(dashboard)/apps/$appId/domains.tsx';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export function AppTabs() {
  const appId = useAppId();
  const tab = useAppTab();
  // Domains wait for an identity. Logs and files do not: a binary that prints its first
  // credential once, on boot, is one a stranger has to be able to read.
  const domains = useSessionIdentity() === SessionIdentity.Person;

  return (
    <Tabs value={tab}>
      <TabsList variant="line">
        <TabsTrigger value="overview" render={<Link to={AppRoute.to} params={{ appId }} />}>
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="logs"
          render={
            <Link
              to={LogsRoute.to}
              params={{ appId }}
              search={{ timerange: DEFAULT_LOG_TIMERANGE }}
            />
          }
        >
          Logs
        </TabsTrigger>
        <TabsTrigger
          value="files"
          render={<Link to={FilesRoute.to} params={{ appId }} search={{ path: GUEST_PATH_ROOT }} />}
        >
          Files
        </TabsTrigger>
        {domains && (
          <TabsTrigger value="domains" render={<Link to={DomainsRoute.to} params={{ appId }} />}>
            Domains
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );
}
