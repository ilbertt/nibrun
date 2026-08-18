import { Button } from '@repo/ui/components/button';
import { BrandMark } from '@repo/ui/custom/brand-mark';
import { Link } from '@tanstack/react-router';
import { SystemStatusBadge } from '#components/system-status-badge.tsx';
import { UserMenu } from '#components/user-menu.tsx';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center border-b">
      <div className="flex w-full items-center gap-3 px-4 lg:px-6">
        <Link to={IndexRoute.to}>
          <BrandMark />
        </Link>
        <nav>
          <Button variant="ghost" size="sm" render={<Link to={AppsRoute.to} />}>
            Apps
          </Button>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SystemStatusBadge />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
