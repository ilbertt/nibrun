import { defineCommand } from '@parshjs/core';
import { unwrap } from '@repo/api-client/unwrap';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { SHARED_OPTIONS } from '#config.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import {
  APP_PAID_REQUEST_TYPE_SCHEMA,
  completePaidRequest,
  PAID_REQUEST_OUTPUT,
  PAID_REQUEST_TYPE_SCHEMA,
  REQUESTED_APPS_AMOUNT_FLAG,
  REQUESTED_APPS_AMOUNT_SCHEMA,
} from '#lib/paid-requests.ts';
import {
  ADDITIONAL_MEMORY_MIB_FLAG,
  ADDITIONAL_VCPU_COUNT_FLAG,
  ADDITIONAL_VOLUME_GIB_FLAG,
  PAID_RESOURCE_OPTIONS_SCHEMA,
} from '#lib/paid-resource-requests.ts';

export const command = defineCommand('paid-request', {
  description: 'Tell us which paid features you need. Repeat to update your request.',
  options: {
    type: {
      schema: PAID_REQUEST_TYPE_SCHEMA,
      description: `Type of paid request. Supported types: ${PAID_REQUEST_TYPE_SCHEMA.options.join(', ')}.`,
    },
    [REQUESTED_APPS_AMOUNT_FLAG]: {
      schema: REQUESTED_APPS_AMOUNT_SCHEMA.optional(),
      description: `Total apps you need (${MIN_PAID_APPS_REQUEST}–${MAX_PAID_APPS_REQUEST}). Only for --type apps; asked when omitted in a terminal.`,
    },
    [ADDITIONAL_VCPU_COUNT_FLAG]: {
      schema: PAID_RESOURCE_OPTIONS_SCHEMA.shape[ADDITIONAL_VCPU_COUNT_FLAG],
      description: 'Additional vCPUs. Only for --type resources; omitted amounts are 0.',
    },
    [ADDITIONAL_MEMORY_MIB_FLAG]: {
      schema: PAID_RESOURCE_OPTIONS_SCHEMA.shape[ADDITIONAL_MEMORY_MIB_FLAG],
      description: 'Additional RAM in MiB. Only for --type resources; omitted amounts are 0.',
    },
    [ADDITIONAL_VOLUME_GIB_FLAG]: {
      schema: PAID_RESOURCE_OPTIONS_SCHEMA.shape[ADDITIONAL_VOLUME_GIB_FLAG],
      description: 'Additional volume in GiB. Only for --type resources; omitted amounts are 0.',
    },
    [SHARED_OPTIONS.app.name]: {
      ...SHARED_OPTIONS.app.option,
      description: `App name or slug. Only for --type ${APP_PAID_REQUEST_TYPE_SCHEMA.options.join(' or ')}; asked for when omitted in a terminal.`,
    },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function requestPaidFeature({ options, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: PAID_REQUEST_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { requestType, ...body } = await completePaidRequest({
      options,
      interactive,
      api: context.api,
    });
    const saved = unwrap(await context.api.api['paid-requests']({ requestType }).put(body));
    if (saved.requestType !== requestType) {
      throw new Error('The API returned a different paid request type.');
    }
    emit(saved);
  },
});
