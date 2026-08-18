export function TerminalHint() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-muted-foreground text-sm">
      <span>Rather stay in the terminal?</span>
      <code className="whitespace-nowrap rounded-md border bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs">
        nib run ./server
      </code>
    </p>
  );
}
