import { createFileRoute } from '@tanstack/react-router';
import { DeploymentLogs } from '#components/logs/deployment-logs.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId/logs')({
  component: RouteComponent,
});

function RouteComponent() {
  return <DeploymentLogs />;
}
