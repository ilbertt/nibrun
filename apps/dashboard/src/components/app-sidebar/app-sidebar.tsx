import { Link } from '@tanstack/react-router';
import { TerminalIcon } from 'lucide-react';
import { NavUser } from '#components/app-sidebar/nav-user.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#components/ui/sidebar.tsx';
import { useActiveNavItem } from '#lib/hooks/use-active-nav-item.ts';
import { NAV_ITEMS } from '#lib/navigation.ts';
import { Route as IndexRoute } from '#routes/index.tsx';

export function AppSidebar() {
  const activeItem = useActiveNavItem();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link to={IndexRoute.to} />}
            >
              <TerminalIcon className="size-5!" />
              <span className="font-semibold text-base">nibrun</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item === activeItem}
                    render={<Link to={item.to} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
