import { describe, expect, test } from 'bun:test';
import type { CustomHostname } from '#lib/cloudflare/client.ts';
import {
  CustomHostnamesRepository,
  CustomHostnamesUnavailableError,
  toState,
} from '#repositories/custom-hostnames.repository.ts';

function edge({ status, ssl }: { status: string; ssl: string }): CustomHostname {
  return {
    id: 'ch-1',
    hostname: 'app.example.dev',
    status,
    ssl: { status: ssl },
  };
}

describe('a hostname serves only when both halves of it do', () => {
  test('an active hostname with an active certificate is routable', () => {
    expect(toState(edge({ status: 'active', ssl: 'active' }))).toBe('active');
  });

  // The hostname is live but there is no certificate to serve it with, so routing it would be a
  // handshake failure rather than a working domain.
  test('an active hostname whose certificate is still coming is not', () => {
    expect(toState(edge({ status: 'active', ssl: 'pending_validation' }))).toBe('pending');
  });

  test('nor is a certificate that is ready for a hostname that is not', () => {
    expect(toState(edge({ status: 'pending', ssl: 'active' }))).toBe('pending');
  });
});

describe('waiting is the default, because the edge retries on its own', () => {
  // Calling one of these failed would strand a hostname that was about to work, and the owner
  // would be told to fix something that is already fixing itself.
  test('a status nothing here has an opinion about is still waiting', () => {
    expect(toState(edge({ status: 'pending_deployment', ssl: 'pending_issuance' }))).toBe(
      'pending',
    );
  });

  test('a blocked hostname is finished', () => {
    expect(toState(edge({ status: 'blocked', ssl: 'pending_validation' }))).toBe('failed');
  });

  // A timeout reads transient but is not: it means the owner never placed the records, and
  // nothing at the edge will ask again without being told to.
  test('and so is a validation nobody ever answered', () => {
    expect(toState(edge({ status: 'pending', ssl: 'validation_timed_out' }))).toBe('failed');
  });
});

describe('a deployment with no Cloudflare account says so where the edge would be reached', () => {
  const unconfigured = new CustomHostnamesRepository(undefined);

  // The one question a caller may ask without a client, so it can refuse before writing a row.
  test('it answers that it is unavailable rather than throwing', () => {
    expect(unconfigured.available).toBe(false);
  });

  // Defence for the caller that did not ask: better a named error than a read of `undefined`.
  test('and every call that needs the edge refuses', async () => {
    const hostname = 'app.example.dev' as Parameters<typeof unconfigured.add>[0]['hostname'];

    await expect(unconfigured.add({ hostname })).rejects.toBeInstanceOf(
      CustomHostnamesUnavailableError,
    );
    await expect(unconfigured.dcvTarget({ hostname })).rejects.toBeInstanceOf(
      CustomHostnamesUnavailableError,
    );
    await expect(unconfigured.state({ cloudflareId: 'ch-1' })).rejects.toBeInstanceOf(
      CustomHostnamesUnavailableError,
    );
    await expect(unconfigured.remove({ cloudflareId: 'ch-1' })).rejects.toBeInstanceOf(
      CustomHostnamesUnavailableError,
    );
  });
});
