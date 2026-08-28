import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { AppEnvironment } from '#components/apps/app-environment.tsx';
import { AppRunCommand } from '#components/apps/app-run-command.tsx';
import type { AppSummary } from '#queries/apps.ts';

export function AppConfigCard({ app }: { app: AppSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">HTTP port</span>
          <span className="font-mono tabular-nums">{app.config.httpPort}</span>
        </div>
        <AppRunCommand app={app} />
        <AppEnvironment app={app} />
      </CardContent>
    </Card>
  );
}
