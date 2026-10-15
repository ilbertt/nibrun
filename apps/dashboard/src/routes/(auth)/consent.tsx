import { createFileRoute } from '@tanstack/react-router';
import { McpConsent } from '#components/consent/mcp-consent.tsx';

export const Route = createFileRoute('/(auth)/consent')({ component: RouteComponent });

function RouteComponent() {
  return <McpConsent />;
}
