import type { App } from '@repo/api-client/models';
import { Button } from '@repo/ui/components/button';
import { Field, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authClient } from '#lib/auth.ts';
import { useApps } from '#lib/hooks/use-apps.ts';
import { apiKeysQueryOptions } from '#queries/api-keys.ts';

const SECONDS_PER_DAY = 86_400;

export function CreateApiKey({
  ownerId,
  onCreated,
}: {
  ownerId: string;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [selectedAppIds, setSelectedAppIds] = useState<Array<App['id']>>([]);
  const apps = useApps();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.apiKey.create({
        name: name.trim(),
        metadata: { appIds: selectedAppIds },
        ...(expiry === 'never' ? {} : { expiresIn: Number(expiry) * SECONDS_PER_DAY }),
      });
      if (error) {
        throw new Error(error.message);
      }
      onCreated(data.key);
      setName('');
      setSelectedAppIds([]);
    },
    onSuccess: () => queryClient.invalidateQueries(apiKeysQueryOptions(ownerId)),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <Field>
        <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
        <Input
          id="api-key-name"
          placeholder="GitHub Actions"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={create.isPending}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="api-key-expiry">Expires in</FieldLabel>
        <select
          id="api-key-expiry"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
          disabled={create.isPending}
        >
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
          <option value="never">No expiry</option>
        </select>
      </Field>
      <fieldset className="flex flex-col gap-2" disabled={create.isPending}>
        <legend className="mb-2 font-medium text-sm">Apps this key can access</legend>
        {apps.isPending && <p className="text-muted-foreground text-sm">Loading apps…</p>}
        {apps.error && <p className="text-destructive text-sm">{apps.error.message}</p>}
        {apps.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">Create an app before creating a key.</p>
        )}
        {apps.data?.map((app) => (
          <label key={app.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              checked={selectedAppIds.includes(app.id)}
              onChange={() =>
                setSelectedAppIds((selected) =>
                  selected.includes(app.id)
                    ? selected.filter((id) => id !== app.id)
                    : [...selected, app.id],
                )
              }
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{app.name}</span>
              <span className="block truncate text-muted-foreground text-xs">{app.slug}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
      <Button
        type="submit"
        disabled={create.isPending || !name.trim() || selectedAppIds.length === 0}
      >
        {create.isPending ? 'Creating…' : 'Create API key'}
      </Button>
    </form>
  );
}
