import { API_KEY_APP_PERMISSION } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { useApps } from '#lib/hooks/use-apps.ts';
import { apiKeysQueryOptions } from '#queries/api-keys.ts';

export function ApiKeyList({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient();
  const apps = useApps();
  const keys = useQuery(apiKeysQueryOptions(ownerId));
  const revoke = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await authClient.apiKey.delete({ keyId });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries(apiKeysQueryOptions(ownerId)),
  });

  if (keys.isPending) {
    return <p className="text-muted-foreground text-sm">Loading API keys…</p>;
  }
  if (keys.error) {
    return <p className="text-destructive text-sm">{keys.error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {keys.data.length === 0 && <p className="text-muted-foreground text-sm">No API keys yet.</p>}
      {keys.data.map((key) => (
        <div key={key.id} className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{key.name}</p>
            <p className="text-muted-foreground text-xs">
              {key.start}… ·{' '}
              {key.expiresAt
                ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}`
                : 'No expiry'}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              Apps:{' '}
              {key.permissions?.[API_KEY_APP_PERMISSION]
                ?.map((appId) => apps.data?.find((app) => app.id === appId)?.name ?? appId)
                .join(', ') || 'No app access'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(key.id)}
          >
            Revoke
          </Button>
        </div>
      ))}
      {revoke.error && <p className="text-destructive text-sm">{revoke.error.message}</p>}
    </div>
  );
}
