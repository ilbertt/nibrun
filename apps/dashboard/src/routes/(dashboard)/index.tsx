import { createFileRoute, redirect } from '@tanstack/react-router';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';

export const Route = createFileRoute('/(dashboard)/')({
  beforeLoad: () => {
    throw redirect({ to: AppsRoute.to });
  },
});
