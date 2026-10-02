import { Type } from '@sinclair/typebox';

export const CNAME_RECORD_TYPE = { name: 'CNAME', code: 5 } as const;

const CERTIFICATE_VALIDATION_LABEL = '_acme-challenge';

export const RequiredDomainDnsRecordSchema = Type.Object({
  hostname: Type.String(),
  type: Type.Literal(CNAME_RECORD_TYPE.name),
  target: Type.String(),
});

export type RequiredDomainDnsRecord = typeof RequiredDomainDnsRecordSchema.static;

export function certificateValidationName(hostname: string): string {
  return `${CERTIFICATE_VALIDATION_LABEL}.${hostname}`;
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
  const records: RequiredDomainDnsRecord[] = [
    { hostname, type: CNAME_RECORD_TYPE.name, target: routingTarget },
  ];
  if (dcvTarget !== undefined) {
    records.push({
      hostname: certificateValidationName(hostname),
      type: CNAME_RECORD_TYPE.name,
      target: dcvTarget,
    });
  }
  return records;
}

export function dnsName(value: string): string {
  return value.toLowerCase().replace(/\.$/, '');
}
