import { defineCommand } from '@parshjs/core';
import { unwrap } from '@repo/api-client/unwrap';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { SHARED_OPTIONS } from '#config.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import {
  completePaidRequest,
  PAID_REQUEST_OUTPUT,
  PAID_REQUEST_TYPE_SCHEMA,
  REQUESTED_APPS_AMOUNT_FLAG,
  REQUESTED_APPS_AMOUNT_SCHEMA,
} from '#lib/paid-requests.ts';

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
    [SHARED_OPTIONS.app.name]: {
      ...SHARED_OPTIONS.app.option,
      description:
        'App name or slug. Only for --type custom-bucket; asked for when omitted in a terminal.',
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
