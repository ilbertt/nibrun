import { Button } from '@repo/ui/components/button';
import { Field, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { CopyableLine } from '@repo/ui/custom/copyable-line';
import { useBucketSetup } from '#lib/hooks/use-bucket-setup.ts';

export function BucketSetupForm() {
  const { kind, changeKind, setup, startAgain, error, pending, prepare } = useBucketSetup();

  if (setup) {
    return (
      <div className="space-y-3">
        <p>
          Return this setup code to the MCP client to apply the settings. It expires at{' '}
          {new Date(setup.expiresAt).toLocaleTimeString()}.
        </p>
        <CopyableLine prompt={false} value={setup.setupCode} />
        <Button onClick={startAgain} variant="outline">
          Start again
        </Button>
      </div>
    );
  }
  return (
    <form
      autoComplete="off"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void prepare(event.currentTarget);
      }}
    >
      <p>
        Enter the settings for your existing S3-compatible bucket. Your MCP client will use the
        setup code to configure this app.
      </p>
      <Field>
        <FieldLabel htmlFor="endpoint">HTTPS endpoint</FieldLabel>
        <Input id="endpoint" name="endpoint" type="url" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="bucket">Bucket name</FieldLabel>
        <Input id="bucket" name="bucket" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="region">Region (optional)</FieldLabel>
        <Input id="region" name="region" />
      </Field>
      <Field>
        <FieldLabel htmlFor="bucket-auth">Authentication</FieldLabel>
        <select
          className="rounded-md border bg-background p-2 text-sm"
          id="bucket-auth"
          value={kind}
          onChange={(event) => changeKind(event.target.value)}
        >
          <option value="access-key">Access key</option>
          <option value="session">Session credentials</option>
          <option value="anonymous">Anonymous</option>
        </select>
      </Field>
      {kind !== 'anonymous' && (
        <>
          <Field>
            <FieldLabel htmlFor="accessKeyId">Access key ID</FieldLabel>
            <Input id="accessKeyId" name="accessKeyId" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="secretAccessKey">Secret access key</FieldLabel>
            <Input id="secretAccessKey" name="secretAccessKey" type="password" required />
          </Field>
        </>
      )}
      {kind === 'session' && (
        <Field>
          <FieldLabel htmlFor="sessionToken">Session token</FieldLabel>
          <Input id="sessionToken" name="sessionToken" type="password" required />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="encryptionPassword">ZeroFS encryption password</FieldLabel>
        <Input id="encryptionPassword" name="encryptionPassword" type="password" required />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Preparing…' : 'Generate setup code'}
      </Button>
    </form>
  );
}
