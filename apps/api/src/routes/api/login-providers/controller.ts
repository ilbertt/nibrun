import { SignInProvider } from '@repo/api-constants';
import { Elysia } from 'elysia';
import { env } from '#lib/env.ts';
import { LoginProvidersSchema } from '#routes/api/login-providers/model.ts';

export const LoginProvidersController = new Elysia().get(
  '/login-providers',
  () =>
    env.CHATGPT_CLIENT ? [SignInProvider.GitHub, SignInProvider.ChatGPT] : [SignInProvider.GitHub],
  { response: LoginProvidersSchema },
);
