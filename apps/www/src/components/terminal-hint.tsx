import { SITE_URL } from '#lib/site-url.ts';

const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;

export function TerminalHint() {
  return (
    <p className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-muted-foreground text-sm">
      <span>Rather stay in the terminal?</span>
      <code className="max-w-full rounded-md border bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs">
        {INSTALL_COMMAND}
      </code>
    </p>
  );
}
