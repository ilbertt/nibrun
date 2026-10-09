import { createFileRoute } from '@tanstack/react-router';
import { ApiKeys } from '#components/api-keys/api-keys.tsx';

export const Route = createFileRoute('/(dashboard)/api-keys')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="font-medium text-base">API keys</h1>
      <ApiKeys />
    </div>
  );
}
