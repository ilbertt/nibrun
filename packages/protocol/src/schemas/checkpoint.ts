import { stringEnum } from '@repo/typebox-extensions';

export const CHECKPOINT_STATES = ['pending', 'ready', 'failed'] as const;
export const CheckpointStateSchema = stringEnum(CHECKPOINT_STATES);
export type CheckpointState = typeof CheckpointStateSchema.static;
