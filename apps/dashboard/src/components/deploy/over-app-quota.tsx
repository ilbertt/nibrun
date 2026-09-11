import { HELLO_EMAIL, helloMailto } from '@repo/global-constants';
import type { AppQuotaRefusal } from '@repo/protocol';

/**
 * The api's refusal, said again with the way out as a link: the email arrives already addressed
 * and already asking, so what is left is to send it.
 */
export function OverAppQuota({ refusal }: { refusal: AppQuotaRefusal }) {
  // An account allowed none was told so by the api, and there is no number to ask for more against.
  if (refusal.appsAllowed === 0) {
    return refusal.error;
  }
  const allowed = apps(refusal.appsAllowed);
  return (
    <>
      This account can have {allowed}. Delete one to make room for another, or{' '}
      <a
        href={helloMailto({
          subject: `I need more than ${allowed}`,
          body: `Hi,\n\nI need more than ${allowed}.\n\nThanks!`,
        })}
        className="font-medium underline underline-offset-4"
      >
        send an email to {HELLO_EMAIL}
      </a>{' '}
      to ask for more.
    </>
  );
}

function apps(count: number): string {
  return `${count} app${count === 1 ? '' : 's'}`;
}
