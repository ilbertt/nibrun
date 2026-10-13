import { type Static, Type } from '@sinclair/typebox';

export const DeploymentTokenResourceSchema = Type.Object({
  token: Type.String(),
  expiresAt: Type.String({ format: 'date-time' }),
});

export type DeploymentTokenResource = Static<typeof DeploymentTokenResourceSchema>;
