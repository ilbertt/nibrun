import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '#components/ui/button.tsx';
import { Field, FieldLabel } from '#components/ui/field.tsx';
import { Input } from '#components/ui/input.tsx';

/** Shown when nobody followed the link the CLI printed and typed the address themselves. */
export function DeviceCodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  return (
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
  );
}
