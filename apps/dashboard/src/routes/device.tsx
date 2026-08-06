import { createFileRoute } from '@tanstack/react-router';
import { BrandMark } from '#components/brand-mark.tsx';
import { DeviceApproval } from '#components/device/device-approval.tsx';
import { DeviceCodeForm } from '#components/device/device-code-form.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#components/ui/card.tsx';

type DeviceSearch = {
  user_code?: string;
};

// Named as the flow sends it — the CLI is handed this URL by better-auth with `user_code` already
// on it, so renaming the parameter here would break the link it prints.
export const Route = createFileRoute('/device')({
  validateSearch: (search: Record<string, unknown>): DeviceSearch => ({
    user_code: typeof search.user_code === 'string' ? search.user_code : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { user_code: userCode } = Route.useSearch();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandMark />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in a terminal</CardTitle>
            <CardDescription>
              {userCode
                ? 'Check the code matches the one it showed you.'
                : 'Enter the code it showed you.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {userCode ? <DeviceApproval userCode={userCode} /> : <DeviceCodeForm />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
