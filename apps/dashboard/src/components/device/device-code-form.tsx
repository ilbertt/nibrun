import { Button } from '@repo/ui/components/button';
import { Field, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthCard } from '#components/auth/auth-card.tsx';

/** Shown when nobody followed the link the CLI printed and typed the address themselves. */
export function DeviceCodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  return (
    <AuthCard title="Sign in a terminal" description="Enter the code it showed you.">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/device', search: { user_code: code.trim().toUpperCase() } });
        }}
        className="flex flex-col gap-4"
      >
        <Field>
          <FieldLabel htmlFor="user-code">Code</FieldLabel>
          <Input
            id="user-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoFocus
            className="font-mono uppercase tracking-widest"
          />
        </Field>
        <Button type="submit" size="lg" disabled={code.trim().length === 0}>
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
