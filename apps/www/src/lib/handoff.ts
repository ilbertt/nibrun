import {
  HANDOFF_FRAME_PATH,
  HANDOFF_OFFER,
  isHandoffReady,
  isHandoffStored,
} from '@repo/binary-handoff';

// The app is a different origin, so its storage is only reachable from a document it serves
// itself. A hidden frame is that document: the binary is posted into it and written on the
// far side, which is why dropping here is something the app can still find after the
// navigation below.
const APP_ORIGIN = import.meta.env.DEV ? 'http://localhost:3001' : 'https://app.nibrun.com';

// A frame that never answers would otherwise leave the page spinning for good.
const REPLY_TIMEOUT_MS = 15_000;

export function appDestination(): string {
  return `${APP_ORIGIN}${HANDOFF_FRAME_PATH}`;
}

export function handOffBinary(binary: File): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'nibrun handoff';
  frame.src = appDestination();

  const timer = setTimeout(function giveUp() {
    settle(new Error('The app did not answer. Check your connection and try again.'));
  }, REPLY_TIMEOUT_MS);

  function settle(failure?: Error): void {
    clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    frame.remove();
    if (failure) {
      reject(failure);
    } else {
      resolve();
    }
  }

  function onMessage(event: MessageEvent): void {
    // The frame is the only thing worth hearing from — origin alone would still let any other
    // document on the app's origin talk to this page.
    if (event.origin !== APP_ORIGIN || event.source !== frame.contentWindow) {
      return;
    }
    if (isHandoffReady(event.data)) {
      frame.contentWindow?.postMessage({ kind: HANDOFF_OFFER, binary }, APP_ORIGIN);
      return;
    }
    if (isHandoffStored(event.data)) {
      settle();
    }
  }

  window.addEventListener('message', onMessage);
  // appendChild, not append: wrangler's generated types declare their own global `Element`,
  // which merges with the DOM's and leaves `append` resolving to HTMLRewriter's overload.
  document.body.appendChild(frame);

  return promise;
}
