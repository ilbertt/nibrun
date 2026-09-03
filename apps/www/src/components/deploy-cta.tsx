import { DEPLOY_PATH } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { DASHBOARD_ORIGIN } from '#lib/dashboard-origin.ts';

// The same destination the README badge points at, drawn in the site's own button rather than as
// that badge's image: the badge is sized and coloured to survive on somebody else's page, and at
// 158x32 in a fixed dark chip it reads as a foreign object here.
const DEPLOY_URL = `${DASHBOARD_ORIGIN}${DEPLOY_PATH}`;

export function DeployCta() {
  return (
    <div className="flex w-full justify-center border-border/60 border-t py-16 sm:py-20">
      {/* No brand mark beside the label: the mark is a green gradient over dark ink, and on the
          primary green only the ink survives. The label already names nibrun. */}
      <Button size="lg" render={<a href={DEPLOY_URL} />}>
        Deploy on nibrun
      </Button>
    </div>
  );
}
