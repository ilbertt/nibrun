import type { ReactNode } from 'react';

/**
 * The page's one section construction: same divider, same padding, same heading size, same left
 * edge. Sections are meant to differ in what they hold, never in how they are built — so a section
 * that wants its own spacing should be reaching for the values here rather than a new one.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full flex-col gap-8 border-border/60 border-t py-20 sm:py-28">
      <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}
