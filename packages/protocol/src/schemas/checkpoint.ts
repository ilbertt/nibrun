import { stringEnum } from '#lib/string-enum.ts';

export const CHECKPOINT_STATES = ['pending', 'ready', 'failed'] as const;
export const CheckpointStateSchema = stringEnum(CHECKPOINT_STATES);
export type CheckpointState = typeof CheckpointStateSchema.static;
