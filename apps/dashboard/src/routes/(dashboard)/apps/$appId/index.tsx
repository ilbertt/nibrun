import { createFileRoute } from '@tanstack/react-router';
import { AppDetail } from '#components/apps/app-detail.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId/')({ component: RouteComponent });

function RouteComponent() {
  return <AppDetail />;
}
