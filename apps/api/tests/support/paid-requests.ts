import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import type { PaidRequestRow } from '#repositories/paid-requests.repository.ts';

export const CUSTOM_BUCKET_REQUEST = {
  requestType: 'custom-bucket' as const,
  appId: Value.Parse(AppIdSchema, '019a0a00-0000-7000-8000-000000000001'),
};

export const ALWAYS_ON_REQUEST = {
  requestType: 'always-on' as const,
  appId: CUSTOM_BUCKET_REQUEST.appId,
};

export const RESOURCES_REQUEST = {
  requestType: 'resources' as const,
  appId: CUSTOM_BUCKET_REQUEST.appId,
  requestedVcpuCount: 1,
  requestedMemoryMib: 512,
  requestedVolumeGib: 16,
};

export const APP_PAID_REQUESTS = [CUSTOM_BUCKET_REQUEST, ALWAYS_ON_REQUEST, RESOURCES_REQUEST];

export function paidRequestBody(request: PaidRequest): Record<string, unknown> {
  return Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'requestType'));
}

export function paidRequestRow(request: PaidRequest): PaidRequestRow {
  return {
    request_type: request.requestType,
    app_id: request.requestType === 'apps' ? null : request.appId,
    requested_apps_amount: request.requestType === 'apps' ? request.requestedAppsAmount : null,
    requested_vcpu_count: request.requestType === 'resources' ? request.requestedVcpuCount : null,
    requested_memory_mib: request.requestType === 'resources' ? request.requestedMemoryMib : null,
    requested_volume_gib: request.requestType === 'resources' ? request.requestedVolumeGib : null,
  };
}
