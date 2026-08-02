import { createFileRoute } from '@tanstack/react-router';
import { HealthStatus } from '#components/health-status.tsx';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
  const { session } = Route.useRouteContext();

  return (
    <div className="p-8">
      <h1 className="font-bold text-4xl">Welcome back, {session?.user.name}</h1>
      <p className="mt-4 text-lg">
        Edit <code>src/routes/index.tsx</code> to get started.
      </p>
      <div className="mt-6">
        <HealthStatus />
      </div>
    </div>
  );
}
