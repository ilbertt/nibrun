export function ExportAnytime() {
  return (
    <section className="flex w-full flex-col gap-8 border-border/60 border-t py-16 sm:py-20 lg:flex-row lg:gap-16">
      <div className="flex flex-1 flex-col gap-4">
        <h2 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
          Leave whenever you want.
        </h2>
        <p className="text-pretty text-lg text-muted-foreground">
          One click gives you the binary and the entire disk.
        </p>
      </div>
      <p className="flex-1 text-pretty text-lg text-muted-foreground">
        There&apos;s no managed database to migrate off, because there was never a managed database.
        Your data was always just files.
      </p>
    </section>
  );
}
