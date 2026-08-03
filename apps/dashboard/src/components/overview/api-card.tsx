import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '#components/ui/card.tsx';
import { type ApiHealth, useApiHealth } from '#lib/hooks/use-api-health.ts';

const STATUS_FOOTER: Record<ApiHealth['status'], string> = {
  checking: 'Waiting for the first response.',
  reachable: 'Serving requests and reaching the database.',
  unreachable: 'The last health check did not come back.',
};

export function ApiCard() {
  const { status } = useApiHealth();

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>API</CardDescription>
        <CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl">
          {status === 'reachable' ? 'Healthy' : 'Degraded'}
        </CardTitle>
      </CardHeader>
      <CardFooter className="text-muted-foreground text-sm">{STATUS_FOOTER[status]}</CardFooter>
    </Card>
  );
}
