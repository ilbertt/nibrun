import { stringEnum } from '@repo/typebox-extensions';

export const EXPORT_STATES = ['pending', 'preparing', 'ready', 'failed', 'expired'] as const;
export const ExportStateSchema = stringEnum(EXPORT_STATES);
export type ExportState = typeof ExportStateSchema.static;
