import type { ReactNode } from 'react';

export function LabeledDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
