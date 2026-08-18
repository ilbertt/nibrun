export function TerminalHint() {
  return (
    <p className="text-center text-muted-foreground text-sm">
      Rather stay in the terminal?{' '}
      <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs">
        nib run ./server
      </code>
    </p>
  );
}
