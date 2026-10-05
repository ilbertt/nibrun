import type { RequiredDomainDnsRecord } from '#models.ts';
import * as contract from '#public-contract.gen.ts';

export const APP_STATES = contract.APP_STATES;
export const APP_ACTIVATIONS = contract.APP_ACTIVATIONS;
export const APP_HOSTNAME_STATES = contract.APP_HOSTNAME_STATES;
export const APP_HOSTNAME_KINDS = contract.APP_HOSTNAME_KINDS;
export const DEPLOYMENT_STATES = contract.DEPLOYMENT_STATES;
export const INSTANCE_STATES = contract.INSTANCE_STATES;
export const TENANT_LOG_STREAMS = contract.TENANT_LOG_STREAMS;
export const FILESYSTEM_ENTRY_KINDS = contract.FILESYSTEM_ENTRY_KINDS;
export const DEFAULT_HTTP_PORT = contract.DEFAULT_HTTP_PORT;
export const DEFAULT_VOLUME_SIZE_BYTES = contract.DEFAULT_VOLUME_SIZE_BYTES;
export const DEFAULT_INSTANCE_RESOURCES = contract.DEFAULT_INSTANCE_RESOURCES;
export const DEFAULT_LOG_TIMERANGE = contract.DEFAULT_LOG_TIMERANGE;
export const LOG_TIMERANGE_PATTERN = contract.LOG_TIMERANGE_PATTERN;
export const DIRECTORY_ENTRY_LIMIT = contract.DIRECTORY_ENTRY_LIMIT;
export const MIN_IDLE_TIMEOUT_MS = contract.MIN_IDLE_TIMEOUT_MS;
export const MAX_IDLE_TIMEOUT_MS = contract.MAX_IDLE_TIMEOUT_MS;
export const CRON_TIME_ZONE = contract.CRON_TIME_ZONE;
export const REDACTED = contract.REDACTED;
export const CNAME_RECORD_TYPE = contract.CNAME_RECORD_TYPE;
export const RUNTIME_VALUES = contract.RUNTIME_VALUES;
export type RuntimeValue = (typeof RUNTIME_VALUES)[keyof typeof RUNTIME_VALUES];
export type RuntimeValueName = RuntimeValue['name'];
export const RUNTIME_VALUE_NAMES: readonly RuntimeValueName[] = Object.values(RUNTIME_VALUES).map(
  (value) => value.name,
);
export const EXTRA_PUBLIC_PORT_VALUES = [
  RUNTIME_VALUES.EXTRA_PUBLIC_PORT,
  RUNTIME_VALUES.PUBLIC_IPV4,
] as const;

const TENANT_VALUE = new RegExp(contract.TENANT_VALUE_PATTERN);
const NAMES_A_PORT = new RegExp(
  `\\$\\{(?:${EXTRA_PUBLIC_PORT_VALUES.map((value) => value.name).join('|')})\\}`,
);

export function namesOfferedRuntimeValues(value: string): boolean {
  return TENANT_VALUE.test(value);
}

export function interpolableRuntimeValue(name: string): string {
  return `\${${name}}`;
}

export function namesExtraPublicPortValues(value: string): boolean {
  return NAMES_A_PORT.test(value);
}

export function requiredDomainDnsRecords({
  hostname,
  routingTarget,
  dcvTarget,
}: {
  hostname: string;
  routingTarget: string;
  dcvTarget: string | undefined;
}): RequiredDomainDnsRecord[] {
  const templates =
    dcvTarget === undefined
      ? contract.DOMAIN_DNS_RECORD_TEMPLATES.routing
      : contract.DOMAIN_DNS_RECORD_TEMPLATES.withCertificate;
  function render(template: string): string {
    return template
      .replaceAll('{hostname}', hostname)
      .replaceAll('{routingTarget}', routingTarget)
      .replaceAll('{dcvTarget}', dcvTarget ?? '');
  }
  return templates.map((record) => ({
    ...record,
    hostname: render(record.hostname),
    target: render(record.target),
  }));
}
