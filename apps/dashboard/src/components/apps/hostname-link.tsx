import { ExternalLinkIcon } from 'lucide-react';

export function HostnameLink({ hostname }: { hostname: string }) {
  return (
    <a
      href={`https://${hostname}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1.5 font-mono hover:underline"
    >
      <span className="truncate">{hostname}</span>
      <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}
