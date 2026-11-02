import { appUrl } from '@repo/app-ui';
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/avatar';
import { AppWindowIcon } from 'lucide-react';
import type { AppSummary } from '#queries/apps.ts';

export function AppIcon({ app }: { app: AppSummary }) {
  const faviconUrl = new URL('/favicon.ico', appUrl(app.hostnames)).href;

  return (
    <Avatar size="sm" className="rounded-md after:rounded-md" aria-hidden="true">
      <AvatarImage
        key={faviconUrl}
        src={faviconUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="rounded-md object-contain"
      />
      <AvatarFallback className="rounded-md">
        <AppWindowIcon className="size-4" />
      </AvatarFallback>
    </Avatar>
  );
}
