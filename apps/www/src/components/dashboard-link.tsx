import { Button } from '@repo/ui/components/button';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';

// Same tab, no target: the drop below navigates this window to the app, and a header that
// opened a second one would leave the two halves of the same journey behaving differently.
export function DashboardLink() {
  return (
    <Button size="sm" render={<a href={DASHBOARD_ORIGIN} />}>
      Deploy
    </Button>
  );
}
