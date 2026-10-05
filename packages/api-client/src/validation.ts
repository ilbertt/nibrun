import { Value } from '@sinclair/typebox/value';
import * as contract from '#public-contract.gen.ts';

export const AppNameSchema = contract.AppNameSchema;
export const HttpPortSchema = contract.HttpPortSchema;
export const TenantEnvironmentPatchSchema = contract.TenantEnvironmentPatchSchema;
export const FilenameSchema = contract.FilenameSchema;
export const Sha256DigestSchema = contract.Sha256DigestSchema;
export const HostnameSchema = contract.HostnameSchema;
export const GuestPathSchema = contract.GuestPathSchema;
export const TimestampSchema = contract.TimestampSchema;
export const AppIdSchema = contract.AppIdSchema;
export const CronJobIdSchema = contract.CronJobIdSchema;
export const SecretStringSchema = contract.SecretStringSchema;
export const GUEST_PATH_ROOT = Value.Parse(GuestPathSchema, '/');
