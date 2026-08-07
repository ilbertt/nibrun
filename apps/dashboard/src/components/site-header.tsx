import { SystemStatusBadge } from '#components/system-status-badge.tsx';
import { Separator } from '#components/ui/separator.tsx';
import { SidebarTrigger } from '#components/ui/sidebar.tsx';
import { useActiveNavItem } from '#lib/hooks/use-active-nav-item.ts';

export function SiteHeader() {
  const activeItem = useActiveNavItem();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <h1 className="font-medium text-base">{activeItem?.title}</h1>
        <div className="ml-auto">
          <SystemStatusBadge />
        </div>
      </div>
    </header>
  );
}
