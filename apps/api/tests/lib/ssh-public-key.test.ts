import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { BadRequestError } from '#lib/errors.ts';
import { parseSshPublicKey } from '#lib/ssh-public-key.ts';
import { DEPLOY_KEY_FINGERPRINT, DEPLOY_PUBLIC_KEY } from '#tests/support/deploy-key.ts';

describe('OpenSSH deploy public keys', () => {
  test('normalizes whitespace and drops comments without changing the OpenSSH fingerprint', () => {
    expect(parseSshPublicKey(`  ${DEPLOY_PUBLIC_KEY.replace(' ', '\t')} user@machine  \n`)).toEqual(
      {
        publicKey: DEPLOY_PUBLIC_KEY,
        fingerprint: DEPLOY_KEY_FINGERPRINT,
      },
    );
  });

  test.each([
    '',
    'ssh-ed25519 not-base64!',
    'ssh-ed25519 AAAA',
    DEPLOY_PUBLIC_KEY.replace('ssh-ed25519', 'ssh-rsa'),
    `restrict ${DEPLOY_PUBLIC_KEY}`,
    `command="deploy" ${DEPLOY_PUBLIC_KEY}`,
    `${DEPLOY_PUBLIC_KEY}\n${DEPLOY_PUBLIC_KEY}`,
    `${DEPLOY_PUBLIC_KEY}=`,
    '-----BEGIN OPENSSH PRIVATE KEY-----',
  ])('refuses malformed, unsupported, or private key input: %s', (source) => {
    expect(() => parseSshPublicKey(source)).toThrow(BadRequestError);
  });

  test('rejects a blob whose algorithm differs from its label', () => {
    const blob = publicKeyBlob();
    blob.write('ssh-ed448', blob.indexOf('ssh-ed25519'));

    expect(() => parseSshPublicKey(`ssh-ed25519 ${blob.toString('base64')}`)).toThrow(
      BadRequestError,
    );
  });

  test('rejects trailing bytes in an otherwise valid blob', () => {
    const blob = Buffer.concat([publicKeyBlob(), Buffer.from('extra')]);

    expect(() => parseSshPublicKey(`ssh-ed25519 ${blob.toString('base64')}`)).toThrow(
      BadRequestError,
    );
  });
});

function publicKeyBlob(): Buffer {
  return Buffer.from(DEPLOY_PUBLIC_KEY.split(' ')[1]!, 'base64');
}
