import { describe, expect, test } from 'bun:test';
import {
  credentialsFromEnvironment,
  fetchInstanceCredentials,
  InstanceCredentialsError,
  needsRefresh,
  parseCredentialsDocument,
} from '#aws/instance-credentials.ts';
import type { HttpClient, HttpRequest } from '#lib/http.ts';

const NOW_MS = 1_700_000_000_000;
const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 600_000;
const ONE_HOUR_MS = 3_600_000;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const ROLE = 'nibrun-app-host';
const DOCUMENT = {
  AccessKeyId: 'AKIAEXAMPLE',
  SecretAccessKey: 'secret',
  Token: 'session',
  Expiration: new Date(NOW_MS + ONE_HOUR_MS).toISOString(),
};

const imds = ({ status = HTTP_OK }: { status?: number } = {}) => {
  const requests: HttpRequest[] = [];
  const http: HttpClient = (request) => {
    requests.push(request);
    if (status !== HTTP_OK) {
      return Promise.resolve(new Response('denied', { status }));
    }
    if (request.url.endsWith('/api/token')) {
      return Promise.resolve(new Response('token-value'));
    }
    if (request.url.endsWith('security-credentials/')) {
      return Promise.resolve(new Response(`${ROLE}\n`));
    }
    return Promise.resolve(new Response(JSON.stringify(DOCUMENT)));
  };
  return { requests, http };
};

describe('static credentials win when they are present', () => {
  test('a full pair is used', () => {
    expect(
      credentialsFromEnvironment({
        AWS_ACCESS_KEY_ID: 'key',
        AWS_SECRET_ACCESS_KEY: 'secret',
        AWS_SESSION_TOKEN: 'token',
      }),
    ).toEqual({ accessKeyId: 'key', secretAccessKey: 'secret', sessionToken: 'token' });
  });

  test('half a pair is not credentials', () => {
    expect(credentialsFromEnvironment({ AWS_ACCESS_KEY_ID: 'key' })).toBeUndefined();
    expect(credentialsFromEnvironment({})).toBeUndefined();
  });
});

describe('refresh happens before the credential can expire mid-transfer', () => {
  test('nothing cached always refreshes', () => {
    expect(needsRefresh({ credentials: undefined, nowMs: NOW_MS })).toBe(true);
  });

  test('a credential with no expiry never refreshes', () => {
    expect(
      needsRefresh({
        credentials: { accessKeyId: 'k', secretAccessKey: 's' },
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  test('the margin refreshes early rather than at the last moment', () => {
    const credentials = {
      accessKeyId: 'k',
      secretAccessKey: 's',
      expiresAtMs: NOW_MS + ONE_MINUTE_MS,
    };
    expect(needsRefresh({ credentials, nowMs: NOW_MS, marginMs: TEN_MINUTES_MS })).toBe(true);
    expect(needsRefresh({ credentials, nowMs: NOW_MS, marginMs: 0 })).toBe(false);
  });
});

describe('IMDSv2', () => {
  test('the session token is fetched first and presented on every later request', async () => {
    const { requests, http } = imds();
    const credentials = await fetchInstanceCredentials({ http });
    expect(credentials.accessKeyId).toBe(DOCUMENT.AccessKeyId);
    expect(credentials.sessionToken).toBe(DOCUMENT.Token);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[1]?.headers?.['x-aws-ec2-metadata-token']).toBe('token-value');
    expect(requests[2]?.url).toEndWith(ROLE);
  });

  test('a refused metadata request is an error, not empty credentials', async () => {
    const { http } = imds({ status: HTTP_FORBIDDEN });
    await expect(fetchInstanceCredentials({ http })).rejects.toThrow(InstanceCredentialsError);
  });
});

describe('parsing the credential document', () => {
  test('a well-formed document carries its expiry through as epoch milliseconds', () => {
    expect(parseCredentialsDocument(DOCUMENT).expiresAtMs).toBe(NOW_MS + ONE_HOUR_MS);
  });

  test('a document with no key pair is refused', () => {
    expect(() => parseCredentialsDocument({ Code: 'Failure' })).toThrow(InstanceCredentialsError);
    expect(() => parseCredentialsDocument(null)).toThrow(InstanceCredentialsError);
  });

  test('an unparsable expiry is dropped rather than becoming NaN', () => {
    const parsed = parseCredentialsDocument({ ...DOCUMENT, Expiration: 'soon' });
    expect('expiresAtMs' in parsed).toBe(false);
  });
});
