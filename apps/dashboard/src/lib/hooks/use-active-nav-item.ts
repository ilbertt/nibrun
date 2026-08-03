import { useMatchRoute } from '@tanstack/react-router';
import { NAV_ITEMS, type NavItem } from '#lib/navigation.ts';

export function useActiveNavItem(): NavItem | undefined {
  const matchRoute = useMatchRoute();

  return NAV_ITEMS.find((item) => matchRoute({ to: item.to, fuzzy: true }));
}
