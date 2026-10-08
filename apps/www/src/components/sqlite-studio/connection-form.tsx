import type { SqliteConnection } from '@repo/sqlite-explorer';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Label } from '@repo/ui/components/label';
import { DatabaseIcon, LoaderCircleIcon } from 'lucide-react';
import { type SubmitEvent, useEffect, useId, useState } from 'react';

export function ConnectionForm({
  connecting,
  error,
  connect,
}: {
  connecting: boolean;
  error: string | undefined;
  connect: (connection: SqliteConnection) => void;
}) {
  const formId = useId();
  const [interactive, setInteractive] = useState(false);
  // Native submission before hydration would put credentials in the URL.
  useEffect(() => setInteractive(true), []);
  const disabled = connecting || !interactive;

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    connect({
      url: String(form.get('url') ?? '').trim(),
      authToken: String(form.get('authToken') ?? '').trim(),
    });
  }
  return (
    <section className="mx-auto flex h-full w-full max-w-lg items-center px-6 py-12">
      <div className="w-full rounded-xl border border-border/20 bg-card p-8 shadow-sm">
        <DatabaseIcon aria-hidden="true" className="mb-5 size-9 text-primary" />
        <h1 className="font-semibold text-3xl tracking-tight">Explore your SQLite database</h1>
        <p className="mt-3 text-muted-foreground text-sm">
          Connect with a libSQL URL and token to browse tables and run SQL.
        </p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-url`}>libSQL URL</Label>
            <Input
              id={`${formId}-url`}
              name="url"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="libsql://your-database.turso.io"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-token`}>Access token</Label>
            <Input
              id={`${formId}-token`}
              name="authToken"
              type="password"
              autoComplete="off"
              placeholder="Paste your token"
              disabled={disabled}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Your token is kept for this page session. Your browser connects directly to the database
            URL you enter.
          </p>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={disabled}>
            {connecting ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <DatabaseIcon aria-hidden="true" />
            )}
            {connecting ? 'Connecting…' : 'Open database'}
          </Button>
        </form>
      </div>
    </section>
  );
}
