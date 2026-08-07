import { GUEST_PATH_ROOT } from '@repo/protocol';
import { Link } from '@tanstack/react-router';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useAppTab } from '#lib/hooks/use-app-tab.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export function AppTabs() {
  const appId = useAppId();
  const tab = useAppTab();

  return (
    <Tabs value={tab}>
      <TabsList variant="line">
        <TabsTrigger value="overview" render={<Link to={AppRoute.to} params={{ appId }} />}>
          Overview
        </TabsTrigger>
        <TabsTrigger value="logs" render={<Link to={LogsRoute.to} params={{ appId }} />}>
          Logs
        </TabsTrigger>
        <TabsTrigger
          value="files"
          render={<Link to={FilesRoute.to} params={{ appId }} search={{ path: GUEST_PATH_ROOT }} />}
        >
          Files
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
