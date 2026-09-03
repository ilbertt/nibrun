import { HANDOFF_READY, HANDOFF_STORED, isHandoffOffer } from '@repo/binary-handoff';
import { useEffect, useState } from 'react';
import { storeHandedOffBinary } from '#lib/handoff-store.ts';
import { LANDING_ORIGIN } from '#lib/site.ts';

function framedByLandingPage(): boolean {
  return window.parent !== window;
}

/**
 * The landing page cannot reach this origin's storage, so it frames this route and posts the
 * binary in. Returns whether the page is that frame — when it is, there is nobody to render
 * for, since the frame is hidden inside the page the visitor is actually looking at.
 */
export function useHandoffReceiver(): boolean {
  const [framed] = useState(framedByLandingPage);

  useEffect(() => {
    if (!framed) {
      return;
    }
    const { parent } = window;

    function onMessage(event: MessageEvent): void {
      // Anything else on the landing origin could post here too, so the parent being the
      // sender is as much a part of trusting this as the origin is.
      if (event.origin !== LANDING_ORIGIN || event.source !== parent) {
        return;
      }
      if (!isHandoffOffer(event.data)) {
        return;
      }
      storeHandedOffBinary(event.data.binary)
        .then(function acknowledge() {
          parent.postMessage({ kind: HANDOFF_STORED }, LANDING_ORIGIN);
        })
        .catch(function staySilent() {
          // No ack: the landing page times out and says so, which is the only thing it could
          // usefully tell someone whose browser refused the write.
        });
    }

    window.addEventListener('message', onMessage);
    parent.postMessage({ kind: HANDOFF_READY }, LANDING_ORIGIN);

    return () => window.removeEventListener('message', onMessage);
  }, [framed]);

  return framed;
}
