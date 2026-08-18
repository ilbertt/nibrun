import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { formatBytes } from '#lib/format-bytes.ts';
import type { AppSummary } from '#queries/apps.ts';

export function AppConfigCard({ app }: { app: AppSummary }) {
  const { guestPort, args, volumeSizeBytes } = app.config;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Guest port</span>
          <span className="font-mono tabular-nums">{guestPort}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Volume size</span>
          <span className="font-mono tabular-nums" title={`${volumeSizeBytes} bytes`}>
            {formatBytes(volumeSizeBytes)}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground">Arguments</span>
          {args.length === 0 ? (
            <span className="text-muted-foreground">None — the binary runs bare.</span>
          ) : (
            <ol className="flex flex-wrap gap-1">
              {[...args.entries()].map(([position, arg]) => (
                <li key={position} className="rounded-md bg-muted px-2 py-0.5 font-mono">
                  {arg}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
