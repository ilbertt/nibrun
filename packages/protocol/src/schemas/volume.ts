import { stringEnum } from '@repo/typebox-extensions';

// `deleted` is reported once the filesystem is actually gone, which is what lets the control
// plane finish deleting an app rather than leave it saying `deleting` forever.
export const VOLUME_STATES = ['pending', 'ready', 'detached', 'deleted', 'failed'] as const;
export const VolumeStateSchema = stringEnum(VOLUME_STATES);
export type VolumeState = typeof VolumeStateSchema.static;
