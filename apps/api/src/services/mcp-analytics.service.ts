import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ANALYTICS_COOKIE_LIFETIME_SECONDS,
  ANALYTICS_IDENTITY_COOKIE,
  MCP_ATTEMPT_COOKIE,
} from '@repo/analytics/config';
import type { AnalyticsEvent, AnalyticsEventData } from '@repo/analytics/events';
import { serverTrackingAllowed } from '@repo/analytics/server';
import { BASE_DOMAIN } from '@repo/global-constants';
import { decodeJwt } from 'jose';
import { AUTH_BASE_PATH } from '#lib/auth/paths.ts';
import {
  analyticsCookie,
  analyticsErrorCode,
  analyticsKey,
  analyticsRedirect,
  analyticsRequestData,
  analyticsResponseData,
  authorizationRequestKey,
  MCP_ANALYTICS_COOKIE_SECONDS,
  MCP_ANALYTICS_WINDOW_MS,
} from '#lib/mcp/analytics.ts';
import type {
  McpAnalyticsAttempt,
  McpAnalyticsRepositoryContract,
} from '#repositories/mcp-analytics.repository.ts';
import { Service } from '#services/service.ts';

type AnalyticsRequest = {
  attempt: McpAnalyticsAttempt;
  createdAccountId: string | undefined;
  signedIn: boolean;
};

type AuthRequest = {
  request: Request;
  handler: (request: Request) => Promise<Response>;
};

export class McpAnalyticsService extends Service {
  private readonly repository: McpAnalyticsRepositoryContract;
  private readonly baseUrl: URL;
  private readonly current = new AsyncLocalStorage<AnalyticsRequest>();

  constructor({
    repository,
    baseUrl,
  }: { repository: McpAnalyticsRepositoryContract; baseUrl: URL }) {
    super();
    this.repository = repository;
    this.baseUrl = baseUrl;
  }

  accountCreated(user: { id: string; isAnonymous?: boolean }): void {
    const current = this.current.getStore();
    if (current && !user.isAnonymous) {
      current.createdAccountId = user.id;
      current.attempt.accountId = user.id;
    }
  }

  sessionObserved({
    session,
    signedIn,
  }: {
    session: { user: { id: string; isAnonymous?: boolean } } | null | undefined;
    signedIn: boolean;
  }): void {
    const current = this.current.getStore();
    if (current && session) {
      current.signedIn ||= signedIn;
      if (!signedIn) {
        current.attempt.previousIdentity = session.user.isAnonymous ? 'anonymous' : 'with-account';
      }
    }
    if (current && session && !session.user.isAnonymous) {
      current.attempt.accountId = session.user.id;
    }
  }

  async handleAuth({ request, handler }: AuthRequest): Promise<Response> {
    const url = new URL(request.url);
    if (!serverTrackingAllowed({ url: this.baseUrl, headers: request.headers })) {
      return handler(request);
    }
    const body = await analyticsRequestData(request);
    const path = url.pathname.slice(AUTH_BASE_PATH.length);
    const attempt = await this.safely(() => this.findAttempt({ request, path, body, url }));
    if (!attempt) {
      return handler(request);
    }
    return this.current.run({ attempt, createdAccountId: undefined, signedIn: false }, async () => {
      const response = await handler(request);
      await this.safely(() => this.authResponse({ response, path, body }));
      if (path === '/oauth2/authorize') {
        response.headers.append(
          'set-cookie',
          `${ANALYTICS_IDENTITY_COOKIE}=${attempt.distinctId}; Domain=${BASE_DOMAIN}; Path=/; Secure; SameSite=Lax; Max-Age=${ANALYTICS_COOKIE_LIFETIME_SECONDS}`,
        );
        response.headers.append(
          'set-cookie',
          `${MCP_ATTEMPT_COOKIE}=${attempt.id}; Path=/; Secure; SameSite=Lax; Max-Age=${MCP_ANALYTICS_COOKIE_SECONDS}`,
        );
      }
      return response;
    });
  }

  private async findAttempt({
    request,
    path,
    body,
    url,
  }: {
    request: Request;
    path: string;
    body: Record<string, unknown>;
    url: URL;
  }): Promise<McpAnalyticsAttempt | undefined> {
    if (path === '/oauth2/authorize') {
      const attempt: McpAnalyticsAttempt = {
        id: crypto.randomUUID(),
        distinctId:
          analyticsCookie({ headers: request.headers, name: ANALYTICS_IDENTITY_COOKIE }) ??
          crypto.randomUUID(),
        userAgent: request.headers.get('user-agent') ?? 'Mozilla/5.0',
        startedAt: Date.now(),
        expiresAt: Date.now() + MCP_ANALYTICS_WINDOW_MS,
        requestKey: authorizationRequestKey(url.searchParams),
        accountId: undefined,
        previousIdentity: 'visitor',
      };
      await this.repository.write({ key: attempt.id, attempt });
      return attempt;
    }
    if (path === '/oauth2/token') {
      return this.tokenAttempt(body);
    }
    if (path.startsWith('/callback/')) {
      const state = url.searchParams.get('state');
      return state ? this.repository.read(`social:${analyticsKey(state)}`) : undefined;
    }
    if (path !== '/sign-in/social' && path !== '/oauth2/consent') {
      return undefined;
    }
    const id = analyticsCookie({ headers: request.headers, name: MCP_ATTEMPT_COOKIE });
    const attempt = id ? await this.repository.read(id) : undefined;
    return attempt &&
      typeof body.oauth_query === 'string' &&
      authorizationRequestKey(new URLSearchParams(body.oauth_query)) === attempt.requestKey
      ? attempt
      : undefined;
  }

  private async tokenAttempt(
    body: Record<string, unknown>,
  ): Promise<McpAnalyticsAttempt | undefined> {
    if (body.grant_type === 'refresh_token' && typeof body.refresh_token === 'string') {
      return await this.repository.read(`refresh:${analyticsKey(body.refresh_token)}`);
    }
    return typeof body.code === 'string'
      ? this.repository.read(`code:${analyticsKey(body.code)}`)
      : undefined;
  }

  private async authResponse({
    response,
    path,
    body,
  }: {
    response: Response;
    path: string;
    body: Record<string, unknown>;
  }): Promise<void> {
    const current = this.current.getStore()!;
    const { attempt } = current;
    const data = await analyticsResponseData(response);
    const redirect = analyticsRedirect({ response, data });
    if (path === '/oauth2/authorize') {
      await this.emit({ name: 'mcp_auth_started', data: this.context(attempt) });
    }
    if (path === '/sign-in/social') {
      await this.signInResponse({ response, data });
    }
    if (path.startsWith('/callback/')) {
      await this.callbackResponse({ response, redirect });
    }
    if (path === '/oauth2/token') {
      await this.tokenResponse({ response, data });
      return;
    }
    await this.authorizationResponse({ response, redirect, path, body, data });
    await this.repository.write({ key: attempt.id, attempt });
  }

  private async authorizationResponse({
    response,
    redirect,
    path,
    body,
    data,
  }: {
    response: Response;
    redirect: URL | undefined;
    path: string;
    body: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<void> {
    const { attempt } = this.current.getStore()!;
    if (redirect?.searchParams.has('code')) {
      const code = redirect.searchParams.get('code')!;
      await this.repository.write({ key: `code:${analyticsKey(code)}`, attempt });
      await this.emit({
        name: 'mcp_authorization_completed',
        data: { ...this.context(attempt), duration_ms: Date.now() - attempt.startedAt },
      });
    } else if (
      path === '/oauth2/consent' &&
      body.accept === false &&
      redirect?.searchParams.get('error') === 'access_denied'
    ) {
      await this.emit({ name: 'mcp_authorization_denied', data: this.context(attempt) });
    } else if (
      (!response.ok && !response.headers.has('location')) ||
      redirect?.searchParams.has('error')
    ) {
      if (path !== '/sign-in/social' && !path.startsWith('/callback/')) {
        await this.authorizationFailed({
          response,
          error: redirect?.searchParams.get('error') ?? data.error,
          phase: path === '/oauth2/consent' ? 'consent' : 'authorization',
        });
      }
    }
  }

  private async signInResponse({
    response,
    data,
  }: {
    response: Response;
    data: Record<string, unknown>;
  }): Promise<void> {
    const { attempt } = this.current.getStore()!;
    await this.emit({
      name: 'sign_in_started',
      data: {
        ...this.context(attempt),
        provider: 'github',
        identity_state: attempt.previousIdentity,
        reason: 'mcp',
      },
    });
    if (response.ok && typeof data.url === 'string') {
      const state = new URL(data.url).searchParams.get('state');
      if (state) {
        await this.repository.write({ key: `social:${analyticsKey(state)}`, attempt });
      }
    } else {
      await this.signInFailed({ response, error: data.code, phase: 'start' });
    }
  }

  private async callbackResponse({
    response,
    redirect,
  }: {
    response: Response;
    redirect: URL | undefined;
  }): Promise<void> {
    const { attempt, createdAccountId, signedIn } = this.current.getStore()!;
    if (createdAccountId && signedIn) {
      await this.emit({
        name: 'sign_up_completed',
        data: { ...this.context(attempt), provider: 'github' },
      });
    }
    if (signedIn) {
      await this.emit({
        name: 'sign_in_completed',
        data: {
          ...this.context(attempt),
          provider: 'github',
          reason: 'mcp',
          identity_state: 'with-account',
          previous_identity_state: attempt.previousIdentity,
          account_type: createdAccountId === attempt.accountId ? 'new' : 'existing',
        },
      });
    } else {
      await this.signInFailed({
        response,
        error: redirect?.searchParams.get('error'),
        phase: 'callback',
      });
    }
  }

  private async tokenResponse({
    response,
    data,
  }: {
    response: Response;
    data: Record<string, unknown>;
  }): Promise<void> {
    const { attempt } = this.current.getStore()!;
    if (response.ok && typeof data.access_token === 'string') {
      // Only decode a token issued by our own successful token endpoint.
      if (typeof data.refresh_token === 'string') {
        await this.repository.write({
          key: `refresh:${analyticsKey(data.refresh_token)}`,
          attempt,
        });
      }
      const claims = decodeJwt(data.access_token);
      if (typeof claims.jti === 'string' && claims.sub === attempt.accountId) {
        await this.repository.write({ key: `token:${analyticsKey(claims.jti)}`, attempt });
      }
    } else {
      await this.authorizationFailed({ response, error: data.error, phase: 'token' });
    }
  }

  async connected({
    request,
    claims,
    response,
  }: {
    request: Request;
    claims: { jti?: string; sub?: string };
    response: Response;
  }): Promise<void> {
    if (!response.ok || !claims.jti || request.headers.get('dnt') === '1') {
      return;
    }
    await this.safely(async () => {
      const attempt = await this.repository.read(`token:${analyticsKey(claims.jti!)}`);
      if (attempt && attempt.accountId === claims.sub) {
        await this.current.run({ attempt, createdAccountId: undefined, signedIn: false }, () =>
          this.emit({
            name: 'mcp_connected',
            data: { ...this.context(attempt), duration_ms: Date.now() - attempt.startedAt },
          }),
        );
      }
    });
  }

  private async signInFailed({
    response,
    error,
    phase,
  }: {
    response: Response;
    error: unknown;
    phase: 'start' | 'callback';
  }): Promise<void> {
    const { attempt } = this.current.getStore()!;
    await this.emit({
      name: 'sign_in_failed',
      data: {
        ...this.context(attempt),
        reason: 'mcp',
        provider: 'github',
        identity_state: attempt.previousIdentity,
        phase,
        error_code: analyticsErrorCode(error),
        http_status: response.status,
      },
    });
  }

  private async authorizationFailed({
    response,
    error,
    phase,
  }: {
    response: Response;
    error: unknown;
    phase: 'authorization' | 'consent' | 'token';
  }): Promise<void> {
    await this.emit({
      name: 'mcp_authorization_failed',
      data: {
        ...this.context(this.current.getStore()!.attempt),
        phase,
        error_code: analyticsErrorCode(error),
        http_status: response.status,
      },
    });
  }

  private context(attempt: McpAnalyticsAttempt): AnalyticsEventData['mcp_auth_started'] {
    return { source: 'mcp', attempt_id: attempt.id };
  }

  private async emit(event: AnalyticsEvent): Promise<void> {
    const { attempt } = this.current.getStore()!;
    if (
      await this.repository.once({
        key: `${attempt.id}:${event.name}`,
        expiresAt: attempt.expiresAt,
      })
    ) {
      void this.repository
        .send({
          event,
          attempt,
          pathname:
            event.name === 'mcp_connected'
              ? '/mcp'
              : event.name === 'sign_in_started' || event.name === 'sign_in_failed'
                ? '/login'
                : '/consent',
        })
        .catch(function ignoreAnalyticsFailure() {});
    }
  }

  private async safely<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch {
      return undefined;
    }
  }
}
