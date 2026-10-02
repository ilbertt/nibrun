import { t } from 'elysia';

export const DomainDnsRecordSchema = t.Object({
  hostname: t.String(),
  type: t.Literal('CNAME'),
  target: t.String(),
  matched: t.Union([t.Boolean(), t.Null()]),
  observedTargets: t.Array(t.String()),
});

export type DomainDnsRecord = typeof DomainDnsRecordSchema.static;

export function dnsName(value: string): string {
  return value.toLowerCase().replace(/\.$/, '');
}
