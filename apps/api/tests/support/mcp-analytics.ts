import { MCP_ATTEMPT_COOKIE } from '@repo/analytics/config';
import type { AnalyticsEvent } from '@repo/analytics/events';
import { DASHBOARD_SITE } from '@repo/global-constants';
import { analyticsKey } from '#lib/mcp/analytics.ts';
import {
  type McpAnalyticsAttempt,
  McpAnalyticsRepositoryContract,
} from '#repositories/mcp-analytics.repository.ts';
import { McpAnalyticsService } from '#services/mcp-analytics.service.ts';

export class McpAnalyticsRecorder extends McpAnalyticsRepositoryContract {
  readonly records = new Map<string, McpAnalyticsAttempt>();
  readonly sent = new Set<string>();
  readonly events: { event: AnalyticsEvent; attempt: McpAnalyticsAttempt; pathname: string }[] = [];

  read(key: string): Promise<McpAnalyticsAttempt | undefined> {
    const attempt = this.records.get(key);
    return Promise.resolve(
      attempt && attempt.expiresAt > Date.now() ? structuredClone(attempt) : undefined,
    );
  }

  write({ key, attempt }: { key: string; attempt: McpAnalyticsAttempt }): Promise<void> {
    this.records.set(key, structuredClone(attempt));
    return Promise.resolve();
  }

  once({ key }: { key: string; expiresAt: number }): Promise<boolean> {
    if (this.sent.has(key)) {
      return Promise.resolve(false);
    }
    this.sent.add(key);
    return Promise.resolve(true);
  }

  send(input: {
    event: AnalyticsEvent;
    attempt: McpAnalyticsAttempt;
    pathname: string;
  }): Promise<void> {
    this.events.push(structuredClone(input));
    return Promise.resolve();
  }
}

const QUERY = new URLSearchParams({
  client_id: 'test-client',
  redirect_uri: 'https://client.test/callback',
  state: 'private-client-state',
  scope: 'mcp offline_access',
  resource: 'https://app.nibrun.com/mcp',
});

export class McpAnalyticsFlow {
  readonly repository = new McpAnalyticsRecorder();
  readonly service = new McpAnalyticsService({
    repository: this.repository,
    baseUrl: new URL(DASHBOARD_SITE.url),
  });
  cookie = '';
  attemptId = '';

  request({
    path,
    body,
    headers,
  }: {
    path: string;
    body: Record<string, unknown> | undefined;
    headers: Record<string, string> | undefined;
  }): Request {
    return new Request(`${DASHBOARD_SITE.url}/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 analytics-test',
        cookie: this.cookie,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async start(headers: Record<string, string> | undefined = undefined): Promise<Response> {
    const response = await this.service.handleAuth({
      request: this.request({ path: `/oauth2/authorize?${QUERY}`, body: undefined, headers }),
      handler: function authorize() {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: `/login?${QUERY}&sig=test-signature` },
          }),
        );
      },
    });
    this.cookie = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    this.attemptId =
      this.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith(`${MCP_ATTEMPT_COOKIE}=`))
        ?.slice(MCP_ATTEMPT_COOKIE.length + 1) ?? '';
    return response;
  }

  async signIn(): Promise<void> {
    const service = this.service;
    await service.handleAuth({
      request: this.request({
        path: '/sign-in/social',
        body: { provider: 'github', oauth_query: `${QUERY}&sig=test-signature` },
        headers: undefined,
      }),
      handler: function signIn() {
        service.sessionObserved({
          session: { user: { id: 'anonymous-user', isAnonymous: true } },
          signedIn: false,
        });
        return Promise.resolve(
          Response.json({
            url: 'https://github.com/login/oauth/authorize?state=private-github-state',
          }),
        );
      },
    });
  }

  async callback({ created, signedIn }: { created: boolean; signedIn: boolean }): Promise<void> {
    const service = this.service;
    await service.handleAuth({
      request: this.request({
        path: '/callback/github?state=private-github-state',
        body: undefined,
        headers: undefined,
      }),
      handler: function callback() {
        if (created) {
          service.accountCreated({ id: 'account-user' });
        }
        if (signedIn) {
          service.sessionObserved({
            session: { user: { id: 'account-user', isAnonymous: false } },
            signedIn: true,
          });
        }
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: signedIn
                ? `/consent?${QUERY}&sig=test-signature`
                : '/api/auth/error?error=access_denied&error_description=private-error',
            },
          }),
        );
      },
    });
  }

  async consent(accept: boolean): Promise<void> {
    const service = this.service;
    await service.handleAuth({
      request: this.request({
        path: '/oauth2/consent',
        body: { accept, oauth_query: `${QUERY}&sig=test-signature` },
        headers: undefined,
      }),
      handler: function consent() {
        service.sessionObserved({ session: { user: { id: 'account-user' } }, signedIn: false });
        return Promise.resolve(
          Response.json({
            redirect_uri: accept
              ? 'https://client.test/callback?code=private-code&state=private-client-state'
              : 'https://client.test/callback?error=access_denied&state=private-client-state',
          }),
        );
      },
    });
  }

  async token(): Promise<void> {
    const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: 'account-user', jti: 'private-token-id' })).toString('base64url')}.test`;
    await this.service.handleAuth({
      request: new Request(`${DASHBOARD_SITE.url}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'private-code' }),
      }),
      handler: function tokenResponse() {
        return Promise.resolve(
          Response.json({ access_token: token, refresh_token: 'private-refresh-token' }),
        );
      },
    });
  }

  connected(): Promise<void> {
    return this.service.connected({
      request: new Request(`${DASHBOARD_SITE.url}/mcp`, { method: 'POST' }),
      claims: { sub: 'account-user', jti: 'private-token-id' },
      response: Response.json({ result: {} }),
    });
  }

  expire(): void {
    for (const attempt of this.repository.records.values()) {
      attempt.expiresAt = 0;
    }
  }

  tokenAttempt(): McpAnalyticsAttempt | undefined {
    return this.repository.records.get(`token:${analyticsKey('private-token-id')}`);
  }
}
