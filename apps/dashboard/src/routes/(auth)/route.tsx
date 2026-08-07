import { createFileRoute, Outlet } from '@tanstack/react-router';
import { BrandMark } from '#components/brand-mark.tsx';

export const Route = createFileRoute('/(auth)')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        <Outlet />
      </div>
    </div>
  );
}
