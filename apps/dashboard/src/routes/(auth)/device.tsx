import { createFileRoute } from '@tanstack/react-router';
import { DeviceApproval } from '#components/device/device-approval.tsx';
import { DeviceCodeForm } from '#components/device/device-code-form.tsx';

type DeviceSearch = {
  user_code?: string;
};

// Named as the flow sends it — the CLI is handed this URL by better-auth with `user_code` already
// on it, so renaming the parameter here would break the link it prints.
export const Route = createFileRoute('/(auth)/device')({
  validateSearch: (search: Record<string, unknown>): DeviceSearch => ({
    user_code: typeof search.user_code === 'string' ? search.user_code : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { user_code: userCode } = Route.useSearch();

  return userCode ? <DeviceApproval userCode={userCode} /> : <DeviceCodeForm />;
}
