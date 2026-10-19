import type { ReactNode } from 'react';
import { PageBackdrop } from '#components/page-backdrop.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import '#styles/prose.css';

type ContentPageProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function ContentPage({ title, description, children }: ContentPageProps) {
  return (
    <>
      <PageBackdrop />
      <main className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-16 sm:pb-20">
        <SiteHeader />
        <article>
          <header className="flex flex-col gap-4 pb-10">
            <h1 className="text-balance font-semibold text-4xl tracking-tight">{title}</h1>
            <p className="text-pretty text-lg text-muted-foreground">{description}</p>
          </header>
          <div className="prose">{children}</div>
        </article>
      </main>
    </>
  );
}
