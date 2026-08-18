import { BrandMark } from '@repo/ui/custom/brand-mark';
import { createFileRoute } from '@tanstack/react-router';
import { BinaryDrop } from '#components/binary-drop.tsx';

export const Route = createFileRoute('/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-10 p-6">
      <BrandMark />
      <div className="w-full max-w-xl">
        <BinaryDrop />
      </div>
    </main>
  );
}
