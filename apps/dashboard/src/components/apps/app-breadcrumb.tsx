import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@repo/ui/components/breadcrumb';
import { Link } from '@tanstack/react-router';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';

export function AppBreadcrumb() {
  const appId = useAppId();
  const app = useApp(appId);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to={AppsRoute.to} />}>Apps</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage className="font-mono">{app.data?.slug ?? appId}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
