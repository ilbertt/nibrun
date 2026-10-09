import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiKeyList } from '#components/api-keys/api-key-list.tsx';
import { CreateApiKey } from '#components/api-keys/create-api-key.tsx';
import { KeepAppsButton } from '#components/login/keep-apps-button.tsx';
import { useSession } from '#lib/hooks/use-session.ts';

export function ApiKeys() {
  const session = useSession();
  const [createdKey, setCreatedKey] = useState<string | undefined>();
  if (!session || session.user.isAnonymous) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground text-sm">Sign in to create API keys.</p>
        <KeepAppsButton size="sm" />
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        API keys can access and manage only the apps you select. Store a key as a GitHub Actions
        secret named <code>NIBRUN_API_KEY</code> and pass it to <code>nib</code> as an environment
        variable.
      </p>
      {createdKey ? (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="font-medium text-sm">Copy your API key</p>
          <p className="text-muted-foreground text-sm">
            This is the only time you can see it. Save it before closing this message.
          </p>
          <Input aria-label="New API key" readOnly value={createdKey} className="font-mono" />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(createdKey).then(
                  () => toast.success('API key copied'),
                  () => toast.error('Could not copy. Select the key and copy it manually.'),
                );
              }}
            >
              Copy
            </Button>
            <Button variant="outline" onClick={() => setCreatedKey(undefined)}>
              I saved it
            </Button>
          </div>
        </div>
      ) : (
        <CreateApiKey ownerId={session.user.id} onCreated={setCreatedKey} />
      )}
      <ApiKeyList ownerId={session.user.id} />
    </div>
  );
}
