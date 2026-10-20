import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { authClient } from '#lib/auth.ts';
import { Route as PasswordLoginRoute } from '#routes/(auth)/login_.password.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

type PasswordFields = { email: string; password: string };
type PasswordSignInForm = {
  fields: PasswordFields;
  change: (input: { field: keyof PasswordFields; value: string }) => void;
  submit: () => void;
  pending: boolean;
  failed: boolean;
};

export function usePasswordSignIn(): PasswordSignInForm {
  const { redirect } = PasswordLoginRoute.useSearch();
  const [fields, setFields] = useState<PasswordFields>({ email: '', password: '' });
  const signIn = useMutation({
    async mutationFn(credentials: PasswordFields) {
      const { error } = await authClient.signIn.email({
        ...credentials,
        callbackURL: redirect ?? IndexRoute.to,
      });
      if (error) {
        throw error;
      }
    },
  });
  return {
    fields,
    change({ field, value }) {
      setFields({ ...fields, [field]: value });
      signIn.reset();
    },
    submit() {
      if (!signIn.isPending) {
        signIn.mutate({ ...fields, email: fields.email.trim() });
      }
    },
    pending: signIn.isPending,
    failed: signIn.isError,
  };
}
