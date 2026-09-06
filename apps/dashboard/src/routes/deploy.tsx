import { deployLink } from '@repo/deploy-link';
import { createFileRoute } from '@tanstack/react-router';
import { HandedOffBinary } from '#components/handoff/handed-off-binary.tsx';
import { discardHandedOffBinary, readHandedOffBinary } from '#lib/handoff-store.ts';
import { useHandoffReceiver } from '#lib/hooks/use-handoff-receiver.ts';

// Outside `(auth)` and `(dashboard)` on purpose: the landing page frames this route, and a
// hidden frame should render neither the signed-in chrome nor the auth card.
export const Route = createFileRoute('/deploy')({
  validateSearch: deployLink,
  loaderDeps: ({ search }) => ({ linkedBinary: search.binary }),
  loader: ({ deps }) => waitingBinary(deps),
  component: RouteComponent,
});

/**
 * The drop this page is for, settled before anything renders rather than arriving into a form
 * that has already been built out of not having it.
 *
 * A link that names its own binary says what to deploy, so a drop left behind by some earlier
 * visit is not it. Thrown away rather than passed over: passed over, it would still be there to
 * answer the next visit that arrives without a link.
 */
function waitingBinary({
  linkedBinary,
}: {
  linkedBinary: string | undefined;
}): Promise<File | undefined> {
  if (linkedBinary === undefined) {
    return readHandedOffBinary();
  }
  discardHandedOffBinary();
  return Promise.resolve(undefined);
}

function RouteComponent() {
  const framed = useHandoffReceiver();

  return framed ? null : <HandedOffBinary />;
}
