import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const LOGS_URL = `${ORIGIN}/api/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}/logs`;

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment logs are read through the api that owns the app', () => {
  test('streaming without a session is refused', async () => {
    expect((await send({ url: LOGS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  // The timerange is turned into the instant the first window starts from, so a value the schema
  // does not admit is refused here rather than carried down and asked of the store.
  test('a timerange that is not a duration never reaches the store', async () => {
    const response = await send({ url: `${LOGS_URL}?timerange=forever` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // A query string carries words, and asking not to follow is a word: the schema is what turns it
  // back into the answer to a yes-or-no question, and getting past it is what says it did.
  test('asking not to follow is a query the schema takes', async () => {
    const response = await send({ url: `${LOGS_URL}?follow=false` });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('and anything that is not a yes or a no is refused', async () => {
    const response = await send({ url: `${LOGS_URL}?follow=maybe` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
