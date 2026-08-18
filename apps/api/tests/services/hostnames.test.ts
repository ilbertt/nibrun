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
import { MS_PER_DAY } from '#lib/duration.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AppHostnameRow,
  AppHostnamesRepositoryContract,
} from '#repositories/app-hostnames.repository.ts';
import type {
  CustomHostnamesRepositoryContract,
  EdgeHostname,
} from '#repositories/custom-hostnames.repository.ts';
import { HostnamesService } from '#services/hostnames.service.ts';
import { uniqueViolation } from '#tests/support/postgres.ts';

const APP_HOST_DOMAIN = 'apps.example.com';
const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-1');
const BROUGHT = Value.Parse(HostnameSchema, 'app.example.dev');
const CLOUDFLARE_ID = 'ch-1';
const PENDING_TTL_DAYS = 7;

type PendingRow = { hostname: Hostname; cloudflare_id: string | null; created_at: Date };

function hostnameRow(overrides: Partial<AppHostnameRow> = {}): AppHostnameRow {
  return {
    hostname: BROUGHT,
    kind: 'custom',
    state: 'pending',
    dcv_target: null,
    ...overrides,
  };
}

class StubHostnamesRepository implements AppHostnamesRepositoryContract {
  readonly trace: string[] = [];
  readonly states: AppHostnameState[] = [];
  pending: PendingRow[] = [];
  owns = true;
  insertFailure: unknown;
  removed: string | null = CLOUDFLARE_ID;

  addCustom(): Promise<AppHostnameRow | null> {
    this.trace.push('insert');
    if (this.insertFailure) {
      return Promise.reject(this.insertFailure);
    }
    return Promise.resolve(this.owns ? hostnameRow() : null);
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

  removeCustom(): Promise<string | null> {
    this.trace.push('remove');
    return Promise.resolve(this.removed);
  }

  listPendingCustom(): Promise<PendingRow[]> {
    return Promise.resolve(this.pending);
  }

  // Reads an app makes of its own hostnames; nothing here asks for them.
  listByOwner = notAsked;
  listByApp = notAsked;
}

function notAsked(): never {
  throw new Error('Not part of what a hostname needs.');
}

class StubEdge implements CustomHostnamesRepositoryContract {
  readonly trace: string[] = [];
  available = true;
  state_: AppHostnameState = 'pending';
  addFailure: unknown;
  removeFailure: unknown;

  add(): Promise<EdgeHostname> {
    this.trace.push('add');
    if (this.addFailure) {
      return Promise.reject(this.addFailure);
    }
    return Promise.resolve({ cloudflareId: CLOUDFLARE_ID, state: 'pending' });
  }

  dcvTarget({ hostname }: { hostname: Hostname }): Promise<string> {
    return Promise.resolve(`${hostname}.uuid.dcv.cloudflare.com`);
  }

  state(): Promise<AppHostnameState> {
    this.trace.push('state');
    return Promise.resolve(this.state_);
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
    appsRepo.insertFailure = uniqueViolation('app_hostnames_hostname_key');

    await expect(service.add(owned())).rejects.toBeInstanceOf(ConflictError);
  });

  // Every other violation means the request itself is wrong in a way retrying cannot fix, and
  // dressing one up as a conflict would tell the owner to try a different hostname.
  test('and any other violation is not rewritten into one', async () => {
    const { service, appsRepo } = build();
    appsRepo.insertFailure = uniqueViolation('some_other_key');

    await expect(service.add(owned())).rejects.not.toBeInstanceOf(ConflictError);
  });

  test('an app the caller does not own is indistinguishable from one that is not there', async () => {
    const { service, appsRepo } = build();
    appsRepo.owns = false;

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
    const { service } = build();

    const added = await service.add(owned());

    expect(added.state).toBe('pending');
    expect(added.dcvTarget).toBe(`${BROUGHT}.uuid.dcv.cloudflare.com`);
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

describe('a waiting hostname is settled by the clock a host report lends', () => {
  function pendingSince(days: number): PendingRow {
    return {
      hostname: BROUGHT,
      cloudflare_id: CLOUDFLARE_ID,
      created_at: new Date(Date.now() - days * MS_PER_DAY),
    };
  }

  test('one the edge is now serving becomes routable', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [pendingSince(1)];
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(appsRepo.states).toEqual(['active']);
  });

  // Writing `pending` over `pending` would touch `updated_at` on every report forever.
  test('one still waiting is left exactly as it was', async () => {
    const { service, appsRepo } = build();
    appsRepo.pending = [pendingSince(1)];

    await service.reconcile();

    expect(appsRepo.states).toEqual([]);
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

  // The edge was away when the owner added it, or this process died between the two writes.
  // Leaving it would mean the owner cannot add the domain again — their own half-finished row
  // holds the name — until the claim lapses a week later.
  test('one that never reached the edge is finished rather than left to lapse', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [{ hostname: BROUGHT, cloudflare_id: null, created_at: new Date() }];
    customHostnamesRepo.state_ = 'active';

    await service.reconcile();

    expect(customHostnamesRepo.trace).toEqual(['add', 'state']);
    expect(appsRepo.trace).toContain('attach');
    expect(appsRepo.states).toEqual(['active']);
  });

  // One hostname the edge cannot answer for is not a reason to stop reading the others.
  test('and one the edge still cannot answer for does not stop the rest', async () => {
    const { service, appsRepo, customHostnamesRepo } = build();
    appsRepo.pending = [
      { hostname: BROUGHT, cloudflare_id: null, created_at: new Date() },
      pendingSince(1),
    ];
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
      { hostname: BROUGHT, cloudflare_id: CLOUDFLARE_ID, created_at: new Date() },
    ];

    await service.reconcile();

    expect(appsRepo.states).toEqual([]);
  });
});
