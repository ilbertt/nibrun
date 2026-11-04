import { requireMainWorkflow } from '#shared/actions.ts';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';

requireMainWorkflow();

const canonical = [requiredEnv('NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER')];
const prefix = requiredEnv('SSM_SECRET_PREFIX');
const retired = [`${prefix}/nibrunner_canister_tls_cert`, `${prefix}/nibrunner_canister_tls_key`];
if (canonical.some((name) => retired.includes(name))) {
  throw new Error('The deployed Tunnel parameter still uses a commissioning name.');
}

const available = (await aws([
  'ssm',
  'get-parameters',
  '--names',
  ...canonical,
  '--query',
  'Parameters[].Name',
  '--output',
  'json',
])
  .quiet()
  .json()) as string[];
if (canonical.some((name) => !available.includes(name))) {
  throw new Error('The Terraform-managed Tunnel token parameter is missing.');
}

const removed = await aws([
  'ssm',
  'delete-parameters',
  '--names',
  ...retired,
  '--query',
  'DeletedParameters',
  '--output',
  'json',
])
  .quiet()
  .json();
console.log('Retired commissioning parameters:', removed);
