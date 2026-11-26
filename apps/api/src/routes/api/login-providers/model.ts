import { SignInProvider } from '@repo/api-constants';
import { t } from 'elysia';

export const LoginProvidersSchema = t.Array(t.Enum(SignInProvider));
