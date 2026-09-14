import { describe, expect, test } from 'bun:test';
import {
  type AppHostnameState,
  type AppId,
  AppIdSchema,
  type Hostname,
  HostnameSchema,
  type OwnerId,
  OwnerIdSchema,
  Value,
} from '@repo/protocol';
import type { DcvMethod } from '#lib/app-hostname.ts';
import { CloudflareError } from '#lib/cloudflare/client.ts';
import { MS_PER_DAY } from '#lib/duration.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AppHostnameRow,
  AppHostnamesRepositoryContract,
  CustomHostnameClaim,
  CustomHostnameRow,
} from '#repositories/app-hostnames.repository.ts';
import {
  type CustomHostnamesRepositoryContract,
  CustomHostnamesUnavailableError,
  type EdgeHostname,
  type EdgeReport,
} from '#repositories/custom-hostnames.repository.ts';
import { ADD_GRACE_MS, HostnamesService } from '#services/hostnames.service.ts';

const APP_HOST_DOMAIN = 'apps.example.com';
const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-1');
const BROUGHT = Value.Parse(HostnameSchema, 'app.example.dev');
const CLOUDFLARE_ID = 'ch-1';
const PENDING_TTL_DAYS = 7;

type PendingRow = {
  id: string;
  hostname: Hostname;
  cloudflare_id: string | null;
  created_at: Date;
};

function hostnameRow(overrides: Partial<AppHostnameRow> = {}): AppHostnameRow {
  return {
    hostname: BROUGHT,
    kind: 'custom',
    state: 'pending',
    dcv_target: null,
    edge_errors: [],
    created_at: new Date(),
    ...overrides,
  };
}

function customHostnameRow(overrides: Partial<CustomHostnameRow> = {}): CustomHostnameRow {
  return { ...hostnameRow(), cloudflare_id: null, ...overrides };
}

class StubHostnamesRepository implements AppHostnamesRepositoryContract {
  readonly trace: string[] = [];
  readonly states: AppHostnameState[] = [];
  readonly reports: EdgeReport[] = [];
  readonly polledAfter: Array<string | null> = [];
  pending: PendingRow[] = [];
  removed: string | null = CLOUDFLARE_ID;
  // What the claim comes to, as the statement would answer it; null is an app not the caller's.
  claim: CustomHostnameClaim | null = { outcome: 'created', row: customHostnameRow() };

  addCustom(): Promise<CustomHostnameClaim | null> {
    this.trace.push('insert');
    return Promise.resolve(this.claim);
  }

  attachCustom({ dcvTarget }: { dcvTarget: string | null }): Promise<AppHostnameRow | null> {
    this.trace.push('attach');
    return Promise.resolve(hostnameRow({ dcv_target: dcvTarget }));
  }

  setCustomState({ state }: { state: AppHostnameState }): Promise<boolean> {
    this.trace.push(`state:${state}`);
    this.states.push(state);
    return Promise.resolve(true);
  }

  // Written only when the edge said something new, as the real one's WHERE decides.
  recordEdgeReport({ report }: { report: EdgeReport }): Promise<boolean> {
    const last = this.reports.at(-1);
    if (last && Bun.deepEquals(last, report)) {
      return Promise.resolve(false);
    }
    this.trace.push(`state:${report.state}`);
    this.states.push(report.state);
    this.reports.push(report);
    return Promise.resolve(true);
  }

  removeCustom(): Promise<string | null> {
    this.trace.push('remove');
    return Promise.resolve(this.removed);
  }

  listPendingCustom({ after }: { after: string | null }): Promise<PendingRow[]> {
    this.polledAfter.push(after);
    return Promise.resolve(this.pending);
  }

  listDisposable = notAsked;
  removeDisposable = notAsked;

  // Reads an app makes of its own hostnames; nothing here asks for them.
  listByOwner = notAsked;
  listByApp = notAsked;
}

function notAsked(): never {
  throw new Error('Not part of what a hostname needs.');
}

class StubEdge implements CustomHostnamesRepositoryContract {
  readonly trace: string[] = [];
  readonly methods: DcvMethod[] = [];
  available = true;
  state_: AppHostnameState = 'pending';
  errors: string[] = [];
  addFailure: unknown;
  removeFailure: unknown;
  revalidateFailure: unknown;

  add({ method }: { method: DcvMethod }): Promise<EdgeHostname> {
    this.trace.push('add');
    this.methods.push(method);
    if (this.addFailure) {
      return Promise.reject(this.addFailure);
    }
    return Promise.resolve({ cloudflareId: CLOUDFLARE_ID, state: 'pending' });
  }

  dcvTarget({ hostname }: { hostname: Hostname }): Promise<string> {
    return Promise.resolve(`${hostname}.uuid.dcv.cloudflare.com`);
  }

  // Refuses as the real one does, so a pass without an edge is shown to write nothing because
  // the edge could not be asked, not because it happened to answer `pending`.
  report(): Promise<EdgeReport> {
    if (!this.available) {
      return Promise.reject(new CustomHostnamesUnavailableError());
    }
    this.trace.push('state');
    return Promise.resolve({
      state: this.state_,
      status: this.state_,
      sslStatus: this.state_,
      errors: this.errors,
    });
  }

  revalidate({ method }: { method: DcvMethod }): Promise<void> {
    this.trace.push('revalidate');
    this.methods.push(method);
    if (this.revalidateFailure) {
      return Promise.reject(this.revalidateFailure);
    }
    return Promise.resolve();
  }

  remove(): Promise<void> {
    this.trace.push('remove');
    if (this.removeFailure) {
      return Promise.reject(this.removeFailure);
    }
    return Promise.resolve();
  }
}

function build({ withEdge = true }: { withEdge?: boolean } = {}) {
  const hostnamesRepo = new StubHostnamesRepository();
  const customHostnamesRepo = new StubEdge();
  customHostnamesRepo.available = withEdge;
  return {
    appsRepo: hostnamesRepo,
    customHostnamesRepo,
    service: new HostnamesService({
      hostnamesRepo,
      customHostnamesRepo,
      appHostDomain: APP_HOST_DOMAIN,
    }),
  };
}

function owned(hostname: Hostname = BROUGHT): {
  appId: AppId;
  ownerId: OwnerId;
  hostname: Hostname;
} {
  return { appId: APP_ID, ownerId: OWNER_ID, hostname };
}

describe('a domain the platform issues is not one an owner may claim', () => {
  test('a name under the app domain is refused before anything is written', async () => {
    const { service, appsRepo } = build();

    await expect(
      service.add(owned(Value.Parse(HostnameSchema, `taken.${APP_HOST_DOMAIN}`))),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(appsRepo.trace).toEqual([]);
  });

  // Uniqueness spans platform and custom together, so this is also what a brought domain hits
  // when it names a hostname nibrun issued to somebody else.
  test('a hostname another app already holds is a conflict the owner can read', async () => {
    const { service, appsRepo } = build();
    appsRepo.claim = { outcome: 'taken' };

    await expect(service.add(owned())).rejects.toBeInstanceOf(ConflictError);
  });

  test('an app the caller does not own is indistinguishable from one that is not there', async () => {
    const { service, appsRepo } = build();
    appsRepo.claim = null;

    await expect(service.add(owned())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the row is written before the edge is told', () => {
  // The reverse order leaves a hostname at the edge that nothing here names — invisible to the
  // pass that would otherwise clean it up, and billed for.
  test('so a crash between the two leaves something findable rather than something orphaned', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();

    await service.add(owned());

    expect(appsRepo.trace[0]).toBe('insert');
    expect(customHostnamesRepo.trace).toContain('add');
  });

  test('and the owner is handed the record to place rather than told to come back', async () => {
    const { service, customHostnamesRepo } = build();

    const { hostname: added, created } = await service.add(owned());

    expect(created).toBe(true);
    expect(added.state).toBe('pending');
    expect(added.dcvTarget).toBe(`${BROUGHT}.uuid.dcv.cloudflare.com`);
    expect(customHostnamesRepo.methods).toEqual(['txt']);
  });

  // The edge proves an apex itself once traffic arrives, so there is no second record to place —
  // and handing one over would be a record nothing ever reads.
  test('an apex is proved over HTTP and handed no delegation record', async () => {
    const { service, customHostnamesRepo } = build();

    const { hostname: added } = await service.add(
      owned(Value.Parse(HostnameSchema, 'example.dev')),
    );

    expect(customHostnamesRepo.methods).toEqual(['http']);
    expect(added.dcvTarget).toBeNull();
  });
});

describe('removing a domain lets the row go whatever the edge says', () => {
  test("a hostname this app never had is not somebody else's to remove", async () => {
    const { service, appsRepo } = build();
    appsRepo.removed = null;

    await expect(service.remove(owned())).rejects.toBeInstanceOf(NotFoundError);
  });

  // A row left behind is a name nobody can ever re-add, and an owner told the removal failed for
  // a reason they cannot act on. The stranded hostname is the pass below's problem.
  test('an edge that refuses does not keep the row alive', async () => {
    const { service, customHostnamesRepo } = build();
    customHostnamesRepo.removeFailure = new Error('cloudflare is away');

    await expect(service.remove(owned())).resolves.toBeUndefined();
  });
});

describe('a domain the app already holds is said again rather than created again', () => {
  function holding(row: Partial<CustomHostnameRow>): ReturnType<typeof build> {
    const built = build();
    built.appsRepo.claim = {
      outcome: 'held',
      row: customHostnameRow({ cloudflare_id: CLOUDFLARE_ID, ...row }),
    };
    return built;
  }

  // The owner who has just fixed their records is the one who knows it is time; the edge's own
  // retries back off to hours.
  test('one still waiting is what asks the edge to check it now', async () => {
    const { service, customHostnamesRepo } = holding({ state: 'pending' });

    const { hostname, created } = await service.add(owned());

    expect(created).toBe(false);
    expect(hostname.state).toBe('pending');
    expect(customHostnamesRepo.trace).toEqual(['revalidate']);
    expect(customHostnamesRepo.methods).toEqual(['txt']);
  });

  test('one already answering has nothing to ask for', async () => {
    const { service, customHostnamesRepo } = holding({ state: 'active' });

    const { hostname, created } = await service.add(owned());

    expect(created).toBe(false);
    expect(hostname.state).toBe('active');
    expect(customHostnamesRepo.trace).toEqual([]);
  });

  // The add that wrote it is still on its way to the edge, or the pass will finish it shortly.
  test('nor has one the edge has not been told about yet', async () => {
    const { service, customHostnamesRepo } = holding({ cloudflare_id: null });

    const { created } = await service.add(owned());

    expect(created).toBe(false);
    expect(customHostnamesRepo.trace).toEqual([]);
  });

  // A failed claim has lapsed or been let go of by the edge, which nothing here can undo.
  test('and a failed one is told what will', async () => {
    const { service } = holding({ state: 'failed' });

    await expect(service.add(owned())).rejects.toBeInstanceOf(ConflictError);
  });

  // The row says pending while the edge has already let the hostname go.
  test('as is one the edge no longer holds', async () => {
    const { service, customHostnamesRepo } = holding({ state: 'pending' });
    customHostnamesRepo.revalidateFailure = new CloudflareError({ status: 404, body: 'gone' });

    await expect(service.add(owned())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('a waiting hostname is settled by the clock a host report lends', () => {
  function pendingSince(days: number): PendingRow {
    return {
      id: 'row-1',
      hostname: BROUGHT,
      cloudflare_id: CLOUDFLARE_ID,
      created_at: new Date(Date.now() - days * MS_PER_DAY),
    };
  }

  // The order itself is the query's; what is the service's is handing back where it got to.
  test('each pass carries on from the last row the one before it took', async () => {
    const { service, appsRepo } = build();
    appsRepo.pending = [pendingSince(1), { ...pendingSince(1), id: 'row-2' }];

    await service.reconcile();
    await service.reconcile();

    expect(appsRepo.polledAfter).toEqual([null, 'row-2']);
  });

  test('and stays where it was when a pass finds nothing to take', async () => {
    const { service, appsRepo } = build();
    appsRepo.pending = [pendingSince(1)];
    await service.reconcile();
    appsRepo.pending = [];

    await service.reconcile();
    await service.reconcile();

    expect(appsRepo.polledAfter).toEqual([null, 'row-1', 'row-1']);
  });

  test('one the edge is now serving becomes routable', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [pendingSince(1)];
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(appsRepo.states).toEqual(['active']);
  });

  // The owner is shown these under the records to place, so the row has to carry them; and the
  // pass runs on every host report, so a report the edge has already given is not written again.
  test('one still waiting carries what the edge says is missing, written when it changes', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [pendingSince(1)];
    customHostnamesRepo.errors = ['custom hostname does not CNAME to this zone.'];

    await service.reconcile();
    await service.reconcile();
    customHostnamesRepo.errors = [];
    await service.reconcile();

    expect(appsRepo.reports.map((report) => report.errors)).toEqual([
      ['custom hostname does not CNAME to this zone.'],
      [],
    ]);
    expect(appsRepo.states).toEqual(['pending', 'pending']);
  });

  // Uniqueness is platform-wide, so a claim nobody ever proved is a name every other owner is
  // refused — including the one who actually controls the domain.
  test('a claim nobody ever proved lapses, and the edge stops holding it', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [pendingSince(PENDING_TTL_DAYS + 1)];

    await service.reconcile();

    expect(customHostnamesRepo.trace).toContain('remove');
    expect(appsRepo.states).toEqual(['failed']);
  });

  test('and it is not expired while the edge still refuses to let go of it', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [pendingSince(PENDING_TTL_DAYS + 1)];
    customHostnamesRepo.removeFailure = new Error('cloudflare is away');

    await service.reconcile();

    expect(appsRepo.states).toEqual([]);
  });

  function unattachedFor(ms: number): PendingRow {
    return {
      id: 'row-1',
      hostname: BROUGHT,
      cloudflare_id: null,
      created_at: new Date(Date.now() - ms),
    };
  }

  // The edge was away when the owner added it, or this process died between the two writes.
  // Leaving it would mean the owner cannot add the domain again — their own half-finished row
  // holds the name — until the claim lapses a week later.
  test('one that never reached the edge is finished rather than left to lapse', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [unattachedFor(ADD_GRACE_MS + 1)];
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(customHostnamesRepo.trace).toEqual(['add', 'state']);
    expect(appsRepo.trace).toContain('attach');
    expect(appsRepo.states).toEqual(['active']);
  });

  // The add that wrote the row is still on its way to the edge: this pass asking too would have
  // the edge refuse one of them as a duplicate, and when that one is the add, the owner is told
  // their domain failed while it was in fact registered.
  test('but not while the add that wrote it may still be finishing it', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [unattachedFor(ADD_GRACE_MS - 1)];
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(customHostnamesRepo.trace).toEqual([]);
    expect(appsRepo.states).toEqual([]);
  });

  // One hostname the edge cannot answer for is not a reason to stop reading the others.
  test('and one the edge still cannot answer for does not stop the rest', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [unattachedFor(ADD_GRACE_MS + 1), pendingSince(1)];
    customHostnamesRepo.addFailure = new Error('cloudflare is away');
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(appsRepo.states).toEqual(['active']);
  });
});

describe('a deployment without an edge says so rather than half-working', () => {
  test('adding a domain is refused outright', async () => {
    const { service } = build({ withEdge: false });

    await expect(service.add(owned())).rejects.toBeInstanceOf(BadGatewayError);
  });

  test('and the pass that settles them does nothing at all', async () => {
    const { service, appsRepo } = build({ withEdge: false });
    appsRepo.pending = [
      { id: 'row-1', hostname: BROUGHT, cloudflare_id: CLOUDFLARE_ID, created_at: new Date() },
    ];

    await service.reconcile();

    expect(appsRepo.states).toEqual([]);
  });
});
