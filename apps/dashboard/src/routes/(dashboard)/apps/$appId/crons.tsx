import { createFileRoute } from '@tanstack/react-router';
import { CronListing } from '#components/crons/cron-listing.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId/crons')({
  component: RouteComponent,
});

function RouteComponent() {
  return <CronListing />;
}
