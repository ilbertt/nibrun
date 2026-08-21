import { createFileRoute } from '@tanstack/react-router';
import { HandedOffBinary } from '#components/handoff/handed-off-binary.tsx';
import { useHandoffReceiver } from '#lib/hooks/use-handoff-receiver.ts';

// What a "Deploy on nibrun" link asks for. Both only prefill a field the owner can still edit,
// and the api validates what is submitted, so an absurd value costs a correction rather than a
// refusal here.
//
// The port is a number because the router parses search values as JSON and writes them back the
// same way: held as a string, `?port=3000` would be rewritten to `?port="3000"` in the address
// bar of everyone who followed the link.
type DeploySearch = {
  name?: string;
  port?: number;
};

// Outside `(auth)` and `(dashboard)` on purpose: the landing page frames this route, and a
// hidden frame should render neither the signed-in chrome nor the auth card.
export const Route = createFileRoute('/deploy')({
  validateSearch: (search: Record<string, unknown>): DeploySearch => ({
    name: typeof search.name === 'string' ? search.name : undefined,
    port: asPort(search.port),
  }),
  component: RouteComponent,
});

function asPort(value: unknown): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

function RouteComponent() {
  const framed = useHandoffReceiver();
  const { name, port } = Route.useSearch();

  return framed ? null : <HandedOffBinary suggested={{ name, port }} />;
}
