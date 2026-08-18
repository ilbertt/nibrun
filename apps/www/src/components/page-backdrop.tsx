// Fixed rather than in flow: the mask is what keeps the grid from reaching the text, so it has
// to stay under the viewport — scrolling it with the page would drift the faded part away from
// whatever is being read.
export function PageBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(currentColor_1px,transparent_1px)] text-muted-foreground/30 [background-size:22px_22px] [mask-image:radial-gradient(ellipse_65%_55%_at_50%_30%,black,transparent)]"
    />
  );
}
