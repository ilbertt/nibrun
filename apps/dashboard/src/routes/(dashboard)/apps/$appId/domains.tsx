import { createFileRoute } from '@tanstack/react-router';
import { DomainsCard } from '#components/apps/domains-card.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId/domains')({
  component: RouteComponent,
});

function RouteComponent() {
  return <DomainsCard />;
}
