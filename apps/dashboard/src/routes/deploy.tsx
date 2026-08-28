import { createFileRoute } from '@tanstack/react-router';
import { HandedOffBinary } from '#components/handoff/handed-off-binary.tsx';
import { deploySuggestion } from '#lib/deploy-link.ts';
import { useHandoffReceiver } from '#lib/hooks/use-handoff-receiver.ts';

// Outside `(auth)` and `(dashboard)` on purpose: the landing page frames this route, and a
// hidden frame should render neither the signed-in chrome nor the auth card.
export const Route = createFileRoute('/deploy')({
  validateSearch: deploySuggestion,
  component: RouteComponent,
});

function RouteComponent() {
  const framed = useHandoffReceiver();
  const suggested = Route.useSearch();

  return framed ? null : <HandedOffBinary suggested={suggested} />;
}
