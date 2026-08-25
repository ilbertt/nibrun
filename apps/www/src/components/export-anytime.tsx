import { Section } from '#components/section.tsx';

export function ExportAnytime() {
  return (
    <Section title="Leave whenever you want.">
      {/* The section spacing value, used once inside a section: what makes this the tallest band on
          the page is the room around the claim, since nothing is allowed to illustrate it. */}
      <div className="flex flex-col gap-20 sm:gap-28">
        <p className="max-w-[65ch] text-pretty text-muted-foreground">
          One click gives you the binary and the entire disk.
        </p>
        {/* The one line on the page a competitor structurally cannot say, so it is the one the
            space is clearing a path to — foreground where the lede above it is muted. */}
        <p className="max-w-[65ch] text-pretty">
          There&apos;s no managed database to migrate off, because there was never a managed
          database. Your data was always just files.
        </p>
      </div>
    </Section>
  );
}
