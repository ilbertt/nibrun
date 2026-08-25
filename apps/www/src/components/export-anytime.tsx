// No environment variable in front of the binary, because there is none to set: the guest
// contract is `data/` relative to the working directory, and the bundle extracts the disk right
// beside the binary. Anything more here would advertise configuration the product doesn't have.
const EXPORT_COMMANDS = ['tar -xzf myapp.tar.gz', './myapp'].join('\n');

export function ExportAnytime() {
  return (
    <section className="flex w-full flex-col gap-10 border-border/60 border-t py-16 sm:py-20 lg:flex-row lg:gap-16">
      <div className="flex flex-1 flex-col gap-4">
        <h2 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
          Leave whenever you want.
        </h2>
        <p className="text-pretty text-lg text-muted-foreground">
          One click gives you the binary and the entire disk.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-5">
        <pre className="overflow-x-auto rounded-2xl border bg-card/80 px-4 py-3.5 font-mono text-sm leading-relaxed shadow-sm backdrop-blur-sm">
          <code>{EXPORT_COMMANDS}</code>
        </pre>
        <p className="text-pretty text-muted-foreground">
          That&apos;s your app, running on any Linux box you own. Same binary you uploaded, same
          bytes that were on the disk.
        </p>
        <p className="text-pretty text-muted-foreground">
          There&apos;s no managed database to migrate off, because there was never a managed
          database. Your data was always just files.
        </p>
      </div>
    </section>
  );
}
