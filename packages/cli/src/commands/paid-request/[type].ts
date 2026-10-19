import { defineCommand } from '@parshjs/core';
import { unwrap } from '@repo/api-client/unwrap';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import {
  PAID_REQUEST_AMOUNT_SCHEMA,
  PAID_REQUEST_OUTPUT,
  PAID_REQUEST_TYPE_SCHEMA,
  requestedPaidAmount,
} from '#lib/paid-requests.ts';

export const command = defineCommand('paid-request [type]', {
  description:
    'Tell us which paid features you need. Currently supports apps; repeat to update your request.',
  params: { type: { schema: PAID_REQUEST_TYPE_SCHEMA } },
  options: {
    amount: {
      schema: PAID_REQUEST_AMOUNT_SCHEMA.optional(),
      description: `Total apps you need (${MIN_PAID_APPS_REQUEST}–${MAX_PAID_APPS_REQUEST}). Asked when omitted in a terminal; required in scripts and with --json. Records interest without changing your current limit.`,
    },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function requestPaidFeature({ params, options, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: PAID_REQUEST_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const amount = await requestedPaidAmount({
      amount: options.amount,
      requestType: params.type,
      interactive,
    });
    emit(
      unwrap(await context.api.api['paid-requests']({ requestType: params.type }).put({ amount })),
    );
  },
});
