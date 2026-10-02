import { recordEntry, trackEvent } from '@repo/analytics';
import { Button } from '@repo/ui/components/button';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';

// Same tab, no target: the drop below navigates this window to the app, and a header that
// opened a second one would leave the two halves of the same journey behaving differently.
export function DashboardLink() {
  return (
    <Button size="sm" render={<a href={DASHBOARD_ORIGIN} />} onClick={trackDashboard}>
      Deploy
    </Button>
  );
}

function trackDashboard(): void {
  recordEntry({ entry_source: 'dashboard-link', preset_slug: undefined });
  trackEvent({
    name: 'deploy_cta_clicked',
    data: { cta_placement: 'header', preset_slug: undefined },
  });
}
