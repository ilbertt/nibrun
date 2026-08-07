import { createFileRoute } from '@tanstack/react-router';
import { AccountCard } from '#components/overview/account-card.tsx';
import { ApiCard } from '#components/overview/api-card.tsx';
import { DeploymentCard } from '#components/overview/deployment-card.tsx';
import { UptimeCard } from '#components/overview/uptime-card.tsx';

export const Route = createFileRoute('/(dashboard)/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4">
        <ApiCard />
        <UptimeCard />
        <AccountCard />
      </div>
      <DeploymentCard />
    </div>
  );
}
