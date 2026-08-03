import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '#components/ui/card.tsx';
import { formatUptime } from '#lib/format-uptime.ts';
import { useApiHealth } from '#lib/hooks/use-api-health.ts';

export function UptimeCard() {
  const { uptimeSeconds } = useApiHealth();

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Uptime</CardDescription>
        <CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
          {uptimeSeconds === undefined ? '—' : formatUptime(uptimeSeconds)}
        </CardTitle>
      </CardHeader>
      <CardFooter className="text-muted-foreground text-sm">
        Since the api process last started.
      </CardFooter>
    </Card>
  );
}
