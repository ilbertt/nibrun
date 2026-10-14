import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { DialogBody } from '@repo/ui/custom/dialog-body';
import { SettingsIcon } from 'lucide-react';
import { GitHubWorkflowSettings } from '#components/apps/github-workflow-settings.tsx';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function DeploymentSettingsDialog() {
  if (useSessionIdentity() !== SessionIdentity.WithAccount) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <SettingsIcon data-icon="inline-start" />
        Deployment settings
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deployment settings</DialogTitle>
          <DialogDescription>Configure automated deployments for this app.</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0">
          <GitHubWorkflowSettings />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
