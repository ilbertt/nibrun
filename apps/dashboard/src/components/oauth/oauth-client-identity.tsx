import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/avatar';
import { useOAuthClientIdentity } from '#lib/hooks/use-oauth-client-identity.ts';

export function OAuthClientIdentity() {
  const { client, logoUrl, onLogoLoadingStatusChange } = useOAuthClientIdentity();
  if (!client) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <Avatar size="lg" className="overflow-hidden">
        <AvatarImage
          key={logoUrl}
          src={logoUrl}
          onLoadingStatusChange={onLogoLoadingStatusChange}
          alt=""
          referrerPolicy="no-referrer"
          className="object-contain"
        />
        <AvatarFallback className="font-semibold text-base" aria-hidden="true">
          {Array.from(client.name)[0]?.toUpperCase()}
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
