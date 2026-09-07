import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Separator } from '@repo/ui/components/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLinkIcon } from 'lucide-react';
import { Gauge, InstrumentPanel, Reading } from '#components/instrument-panel.tsx';
import { pageHead } from '#lib/page-head.ts';

/**
 * Temporary: the dashboard's app page, rebuilt here so a styling direction can be looked at on a
 * preview deployment without a session. Delete once the direction is settled — the real page is
 * `apps/dashboard`, and nothing here is wired to anything.
 */
export const Route = createFileRoute('/dashboard')({
  head: () =>
    pageHead({
      path: '/dashboard',
      title: 'Styling preview',
      description: 'A styling preview of the dashboard. Not a real page.',
    }),
  component: RouteComponent,
});

const LAST_CHANGE = '7 Sep 09:14';

const DEPLOYMENTS = [
  { id: 'dpl_01k9wq', state: 'succeeded', size: '14.2 MB', at: '7 Sep 09:02' },
  { id: 'dpl_01k9dm', state: 'succeeded', size: '14.1 MB', at: '5 Sep 18:44' },
  { id: 'dpl_01k8yr', state: 'failed', size: '14.1 MB', at: '5 Sep 18:31' },
  { id: 'dpl_01k8pv', state: 'succeeded', size: '13.8 MB', at: '2 Sep 11:20' },
];

function RouteComponent() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <p className="border-2 border-warning border-dashed px-3 py-2 font-mono text-muted-foreground text-xs">
        Styling preview. Nothing here is connected — the real page lives in the dashboard.
      </p>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <h1 className="font-medium font-mono text-base">pocketbase</h1>
          <Badge>active</Badge>
        </span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline">
            Suspend
          </Button>
          <Button size="sm">Redeploy</Button>
        </span>
      </header>

      <Tabs value="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <InstrumentPanel name="App">
          <Reading label="State">
            <Badge>active</Badge>
          </Reading>
          <Reading label="Last change">{LAST_CHANGE}</Reading>
          <Separator />
          <span className="flex flex-col gap-2">
            <span className="text-muted-foreground">Hostnames</span>
            <a
              href="https://pocketbase.nibrun.app"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs hover:underline"
            >
              <span className="truncate">pocketbase.nibrun.app</span>
              <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
            </a>
          </span>
        </InstrumentPanel>

        <InstrumentPanel name="Configuration">
          <Reading label="HTTP port">8090</Reading>
          <Reading label="Region">eu-central-1</Reading>
          <Reading label="Sleeps after" hint>
            5 min idle
          </Reading>
          <Separator />
          <span className="flex flex-col gap-2">
            <span className="text-muted-foreground">Run command</span>
            <code className="select-all break-words border-2 border-border bg-input px-2 py-1.5 font-mono text-xs">
              ./pocketbase serve --http 0.0.0.0:8090
            </code>
          </span>
        </InstrumentPanel>

        <InstrumentPanel name="Resources">
          <Gauge label="vCPU" used="0.12" total="1" share={0.12} />
          <Gauge label="Memory" used="211 MiB" total="256 MiB" share={0.82} />
          <Gauge label="Volume" used="964 MiB" total="1.0 GiB" share={0.94} />
        </InstrumentPanel>
      </div>

      <InstrumentPanel name="Deployments" action={<Badge variant="outline">4</Badge>}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deployment</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Binary</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEPLOYMENTS.map((deployment) => (
              <TableRow key={deployment.id}>
                <TableCell className="font-mono text-xs">{deployment.id}</TableCell>
                <TableCell>
                  <Badge variant={deployment.state === 'failed' ? 'destructive' : 'secondary'}>
                    {deployment.state}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{deployment.size}</TableCell>
                <TableCell className="font-mono text-muted-foreground text-xs tabular-nums">
                  {deployment.at}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </InstrumentPanel>
    </main>
  );
}
