import { type AnalyticsEventData, SIGN_IN_REASONS } from '@repo/analytics';
import type { QueryClient } from '@tanstack/react-query';
import { SessionIdentity } from '#lib/session-identity.ts';
import type { AppSummary } from '#queries/apps.ts';

export type SignInReason = AnalyticsEventData['sign_in_started']['reason'];
export type PendingSignIn = {
  reason: SignInReason;
  previous_identity_state: SessionIdentity | undefined;
  anonymous_app_ids: string[];
  expires_at: number;
};
const STORAGE_KEY = 'nibrun.analytics.sign-in';
const SIGN_IN_WINDOW_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60_000;

export function cachedAnonymousApps(queryClient: QueryClient): string[] {
  const cached = queryClient.getQueriesData<AppSummary | AppSummary[]>({ queryKey: ['apps'] });
  const apps = cached.flatMap(([, data]) =>
    data === undefined ? [] : Array.isArray(data) ? data : [data],
  );
  return [...new Set(apps.filter((app) => app.expiresAt !== null).map((app) => app.id))];
}

export function rememberSignIn({
  reason,
  identity,
  anonymousAppIds,
}: {
  reason: SignInReason;
  identity: SessionIdentity;
  anonymousAppIds: string[];
}): void {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        reason,
        previous_identity_state: identity,
        anonymous_app_ids: anonymousAppIds,
        expires_at: Date.now() + SIGN_IN_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
      } satisfies PendingSignIn),
    );
  } catch {
    return;
  }
}

export function forgetSignIn(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function takeSignIn(): PendingSignIn | undefined {
  try {
    return consumeSignIn(window.sessionStorage);
  } catch {
    return undefined;
  }
}

export function consumeSignIn(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
): PendingSignIn | undefined {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    storage.removeItem(STORAGE_KEY);
    if (!stored) {
      return undefined;
    }
    const pending = JSON.parse(stored);
    if (
      !SIGN_IN_REASONS.includes(pending.reason) ||
      (pending.previous_identity_state !== undefined &&
        !Object.values(SessionIdentity).includes(pending.previous_identity_state)) ||
      typeof pending.expires_at !== 'number' ||
      pending.expires_at < Date.now() ||
      !Array.isArray(pending.anonymous_app_ids)
    ) {
      return undefined;
    }
    return {
      reason: pending.reason,
      previous_identity_state: pending.previous_identity_state,
      expires_at: pending.expires_at,
      anonymous_app_ids: pending.anonymous_app_ids.filter((id: unknown) => typeof id === 'string'),
    };
  } catch {
    return undefined;
  }
}

export function verifiedClaims({
  pending,
  apps,
}: {
  pending: PendingSignIn;
  apps: Pick<AppSummary, 'id' | 'expiresAt'>[];
}): string[] {
  const expected = new Set(pending.anonymous_app_ids);
  return apps.filter((app) => expected.has(app.id) && app.expiresAt === null).map((app) => app.id);
}
