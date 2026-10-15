import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/avatar';
import { Plug } from 'lucide-react';
import { useOAuthClientIdentity } from '#lib/hooks/use-oauth-client-identity.ts';

export function OAuthClientIdentity() {
  const { client, logoUrl, onLogoLoadingStatusChange } = useOAuthClientIdentity();
  if (!client) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <Avatar size="lg" className="rounded-lg">
        <AvatarImage
          key={logoUrl}
          src={logoUrl}
          onLoadingStatusChange={onLogoLoadingStatusChange}
          alt=""
          referrerPolicy="no-referrer"
          className="rounded-lg object-contain"
        />
        <AvatarFallback className="rounded-lg">
          <Plug className="size-5" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="wrap-anywhere font-semibold">{client.name}</p>
        {client.domain && (
          <p className="wrap-anywhere text-muted-foreground text-sm">{client.domain}</p>
        )}
      </div>
    </div>
  );
}
