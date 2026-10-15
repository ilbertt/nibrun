import type { InternalAdapter } from '@better-auth/core';
import type { AnalyticsEvent } from '@repo/analytics/events';
import { type ServerAnalyticsIdentity, serverEventPayload } from '@repo/analytics/server';

export type McpAnalyticsAttempt = ServerAnalyticsIdentity & {
  id: string;
  startedAt: number;
  expiresAt: number;
  requestKey: string;
  accountId: string | undefined;
  previousIdentity: string;
};

export abstract class McpAnalyticsRepositoryContract {
  abstract read(key: string): Promise<McpAnalyticsAttempt | undefined>;
  abstract write(input: { key: string; attempt: McpAnalyticsAttempt }): Promise<void>;
  abstract once(input: { key: string; expiresAt: number }): Promise<boolean>;
  abstract send(input: {
    event: AnalyticsEvent;
    attempt: McpAnalyticsAttempt;
    pathname: string;
  }): Promise<void>;
}

const SEND_TIMEOUT_MS = 2_000;

export class McpAnalyticsRepository extends McpAnalyticsRepositoryContract {
  private readonly adapter: () => Promise<InternalAdapter>;
  private readonly baseUrl: URL;
  private readonly hostname: string;

  constructor({
    adapter,
    baseUrl,
    hostname,
  }: { adapter: () => Promise<InternalAdapter>; baseUrl: URL; hostname: string }) {
    super();
    this.adapter = adapter;
    this.baseUrl = baseUrl;
    this.hostname = hostname;
  }

  async read(key: string): Promise<McpAnalyticsAttempt | undefined> {
    const record = await (await this.adapter()).findVerificationValue(`mcp-analytics:${key}`);
    return record && record.expiresAt.getTime() > Date.now() ? JSON.parse(record.value) : undefined;
  }

  async write({ key, attempt }: { key: string; attempt: McpAnalyticsAttempt }): Promise<void> {
    const adapter = await this.adapter();
    const identifier = `mcp-analytics:${key}`;
    const existing = await adapter.findVerificationValue(identifier);
    if (existing) {
      await adapter.updateVerificationByIdentifier(identifier, {
        value: JSON.stringify(attempt),
        expiresAt: new Date(attempt.expiresAt),
      });
      return;
    }
    await adapter.createVerificationValue({
      identifier: `mcp-analytics:${key}`,
      value: JSON.stringify(attempt),
      expiresAt: new Date(attempt.expiresAt),
    });
  }

  async once({ key, expiresAt }: { key: string; expiresAt: number }): Promise<boolean> {
    return (await this.adapter()).reserveVerificationValue({
      identifier: `mcp-analytics:sent:${key}`,
      value: '1',
      expiresAt: new Date(expiresAt),
    });
  }

  async send({
    event,
    attempt,
    pathname,
  }: {
    event: AnalyticsEvent;
    attempt: McpAnalyticsAttempt;
    pathname: string;
  }): Promise<void> {
    if (!this.hostname) {
      return;
    }
    await fetch(`https://${this.hostname}/api/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': attempt.userAgent },
      body: JSON.stringify(
        serverEventPayload({
          event,
          identity: attempt,
          accountId: attempt.accountId,
          identityState: attempt.accountId ? 'with-account' : attempt.previousIdentity,
          url: this.baseUrl,
          pathname,
        }),
      ),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  }
}
