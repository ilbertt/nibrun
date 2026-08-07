import type { LinkProps } from '@tanstack/react-router';
import { BoxesIcon, type LucideIcon } from 'lucide-react';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';

export type NavItem = {
  title: string;
  to: LinkProps['to'];
  icon: LucideIcon;
};

// The sidebar renders these and the header titles itself from whichever one is
// active, so a new page joins both by being added here.
export const NAV_ITEMS: NavItem[] = [{ title: 'Apps', to: AppsRoute.to, icon: BoxesIcon }];
