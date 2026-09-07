import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
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
import { SlideToDelete } from '@repo/ui/custom/slide-to-delete';
import { ChevronDownIcon, ExternalLinkIcon, FileIcon, FolderIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Gauge, InstrumentPanel, Reading } from '#components/instrument-panel.tsx';

const LAST_CHANGE = '7 Sep 09:14';

const DEPLOYMENTS = [
  { id: 'dpl_01k9wq', state: 'succeeded', size: '14.2 MB', at: '7 Sep 09:02' },
  { id: 'dpl_01k9dm', state: 'succeeded', size: '14.1 MB', at: '5 Sep 18:44' },
  { id: 'dpl_01k8yr', state: 'failed', size: '14.1 MB', at: '5 Sep 18:31' },
  { id: 'dpl_01k8pv', state: 'succeeded', size: '13.8 MB', at: '2 Sep 11:20' },
];

const ENTRIES = [
  { name: 'backups', kind: 'directory', size: '—', at: '7 Sep 04:00' },
  { name: 'storage', kind: 'directory', size: '—', at: '6 Sep 22:10' },
  { name: 'data.db', kind: 'file', size: '212.4 MB', at: '7 Sep 09:12' },
  { name: 'data.db-wal', kind: 'file', size: '4.1 MB', at: '7 Sep 09:14' },
  { name: 'logs.db', kind: 'file', size: '18.9 MB', at: '7 Sep 09:14' },
];

const LOG_LINES = [
  { at: '09:14:02.114', stream: 'out', text: 'Server started at http://0.0.0.0:8090' },
  { at: '09:14:02.117', stream: 'out', text: '├─ REST API:  http://0.0.0.0:8090/api/' },
  { at: '09:14:02.118', stream: 'out', text: '└─ Dashboard: http://0.0.0.0:8090/_/' },
  { at: '09:14:06.902', stream: 'out', text: 'GET /api/collections/posts/records 200 3ms' },
  { at: '09:14:07.441', stream: 'out', text: 'GET /api/health 200 0ms' },
  { at: '09:14:31.288', stream: 'err', text: 'WARN sqlite: database is locked, retrying in 40ms' },
  { at: '09:14:31.331', stream: 'out', text: 'POST /api/collections/posts/records 200 51ms' },
  { at: '09:15:00.004', stream: 'out', text: 'checkpoint: wal truncated at 4.1 MB' },
];

/**
 * The dashboard's app page, rebuilt to be looked at rather than used. Every figure is made up and
 * nothing is wired to anything — the point is the styling around it.
 */
const TABS = ['overview', 'logs', 'files', 'domains'] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  overview: 'Overview',
  logs: 'Logs',
  files: 'Files',
  domains: 'Domains',
};

function View({ tab }: { tab: Tab }) {
  if (tab === 'logs') {
    return <LogsView />;
  }
  if (tab === 'files') {
    return <FilesView />;
  }
  return tab === 'domains' ? <DomainsView /> : <Overview />;
}

export function PreviewDashboard() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <h1 className="font-medium font-mono text-base">pocketbase</h1>
          <Badge>active</Badge>
        </span>
        <span className="flex items-center gap-2">
          <ExportDialog />
          <DeleteDialog />
          <Button size="sm" variant="outline">
            Suspend
          </Button>
          <Button size="sm">Redeploy</Button>
        </span>
      </header>

      {/* The list drives the styling, the view is rendered here: `TabsContent` leaves the panel it
          switched away from mounted and visible, so two views stack. */}
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
        <TabsList variant="line">
          {TABS.map((entry) => (
            <TabsTrigger key={entry} value={entry}>
              {LABELS[entry]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <View tab={tab} />
    </div>
  );
}

function Overview() {
  return (
    <div className="flex flex-col gap-6">
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
          <Reading
            label="Sleeps after"
            hint="Nothing runs while it sleeps, and nothing is billed. The next request wakes it in about 112 ms."
          >
            5 min idle
          </Reading>
          <Separator />
          <span className="flex flex-col gap-2">
            <span className="text-muted-foreground">Run command</span>
            <code className="inset-well select-all break-words border-2 border-border bg-input px-2 py-1.5 font-mono text-xs">
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
    </div>
  );
}

function LogsView() {
  return (
    <InstrumentPanel name="Output" action={<TimerangeMenu />}>
      <div className="display-glass flex flex-col gap-0.5 border-2 border-border p-3 font-mono text-xs">
        {LOG_LINES.map((line) => (
          <span key={line.at} className="flex gap-3">
            <span className="shrink-0 text-muted-foreground tabular-nums">{line.at}</span>
            <span className={line.stream === 'err' ? 'text-warning' : ''}>{line.text}</span>
          </span>
        ))}
      </div>
    </InstrumentPanel>
  );
}

const TIMERANGES = ['Last 15 minutes', 'Last hour', 'Last 24 hours', 'Last 7 days'];

/**
 * The one menu here, so a surface that opens over the page can be judged beside the tooltip.
 *
 * Hand-rolled for the same reason as the dialog: the shared primitive resolves a second copy of
 * React inside the Workers runtime this site prerenders through.
 */
function TimerangeMenu() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(TIMERANGES[1]);

  return (
    <span className="relative">
      <Button size="xs" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {chosen}
        <ChevronDownIcon data-icon="inline-end" />
      </Button>
      {open && (
        <span className="floats-above absolute right-0 z-20 mt-1 flex w-max flex-col border-2 border-border bg-popover p-1 text-popover-foreground">
          {TIMERANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => {
                setChosen(range);
                setOpen(false);
              }}
              className={`px-2.5 py-1.5 text-left text-sm hover:bg-accent ${
                range === chosen ? 'text-primary' : ''
              }`}
            >
              {range}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function FilesView() {
  return (
    <InstrumentPanel
      name="data/"
      action={
        <Button size="xs" variant="outline">
          Refresh
        </Button>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Modified</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ENTRIES.map((entry) => (
            <TableRow key={entry.name}>
              <TableCell className="w-full max-w-0 font-mono text-xs">
                <span className="flex items-center gap-2">
                  {entry.kind === 'directory' ? (
                    <FolderIcon className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {entry.name}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {entry.size === '—' ? <span className="text-muted-foreground">—</span> : entry.size}
              </TableCell>
              <TableCell className="font-mono text-muted-foreground text-xs tabular-nums">
                {entry.at}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </InstrumentPanel>
  );
}

function DomainsView() {
  return (
    <InstrumentPanel name="Domains">
      <Reading label="pocketbase.nibrun.app">
        <Badge variant="secondary">platform</Badge>
      </Reading>
      <Separator />
      <Reading label="notes.example.com">
        <Badge variant="outline">pending DNS</Badge>
      </Reading>
      <p className="text-muted-foreground text-xs">
        Add a <span className="font-mono">CNAME</span> for{' '}
        <span className="font-mono">_acme-challenge</span> to finish verifying.
      </p>
    </InstrumentPanel>
  );
}

/** Deleting, which is the one thing here that cannot be undone and so is the one that is slid. */
function DeleteDialog() {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        Delete
      </Button>
      {open && (
        <Shade
          onClose={() => {
            setOpen(false);
            setDeleting(false);
          }}
          title="Delete pocketbase"
          badge="permanent"
        >
          <p className="text-muted-foreground">
            The machine, the disk and everything on it. There is no undo and no copy kept.
          </p>
          <dl className="inset-well flex flex-col gap-2 border-2 border-border bg-input p-3">
            <Reading label="volume">964 MiB, erased</Reading>
            <Reading label="binaries">every one ever uploaded</Reading>
            <Reading label="exports">every bundle ever taken</Reading>
          </dl>
          <SlideToDelete
            label="Slide to delete"
            pendingLabel="Deleting…"
            pending={deleting}
            onDelete={() => setDeleting(true)}
          />
        </Shade>
      )}
    </>
  );
}

/**
 * The overlay and chassis every dialog here is drawn in.
 *
 * Hand-rolled rather than the shared `Dialog`: that primitive resolves a second copy of React
 * inside the Workers runtime this site prerenders through, and reads its hooks off a null one.
 * Nothing about the styling depends on the primitive, and this page exists to show the styling.
 */
function Shade({
  title,
  badge,
  onClose,
  children,
}: {
  title: string;
  badge: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel-face floats-above relative flex w-full max-w-md flex-col border-2 border-border bg-card"
      >
        {/* A bar across the top rather than a name set into the border: a panel's legend works
            because the border runs on to either side of it, and a dialog floating over a dimmed
            page has nothing there for it to interrupt. */}
        <header className="flex items-center justify-between gap-3 border-border border-b-2 px-5 py-3">
          <h2 className="font-heading text-base">{title}</h2>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">
            {badge}
          </span>
        </header>
        <div className="flex flex-col gap-4 p-5 text-sm">{children}</div>
      </div>
    </div>
  );
}

/** Exporting, so a form inside a dialog can be judged beside the page. */
function ExportDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Export
      </Button>
      {open && (
        <Shade title="Export this app" badge="archive" onClose={() => setOpen(false)}>
          <p className="text-muted-foreground">
            One archive: the binary, everything under <span className="font-mono">data/</span>, and
            its environment. Ready in a minute or two.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="preview-export-name">Name the archive</Label>
            <Input id="preview-export-name" defaultValue="pocketbase-2026-09-07" />
          </div>
          <div className="inset-well flex flex-col gap-3 border-2 border-border bg-input p-3">
            <Reading label="Binary">14.2 MB</Reading>
            <Reading label="Volume">964 MiB</Reading>
            <Reading label="Environment">6 variables</Reading>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Start export</Button>
          </div>
        </Shade>
      )}
    </>
  );
}
