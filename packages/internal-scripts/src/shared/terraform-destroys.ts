const RETIRED_NIBRUNNER_TLS_ADDRESSES = new Set([
  'aws_ssm_parameter.nibrunner_origin_tls_cert',
  'aws_ssm_parameter.nibrunner_origin_tls_key',
  'cloudflare_origin_ca_certificate.nibrunner',
  'tls_cert_request.nibrunner',
  'tls_private_key.nibrunner',
]);

type TerraformResourceChange = {
  address: string;
  change: { actions: string[] };
};

export function terraformDestroys({
  resourceChanges,
  allowedAddresses,
}: {
  resourceChanges: TerraformResourceChange[];
  allowedAddresses: Set<string>;
}) {
  const deletions = resourceChanges.filter((resource) =>
    resource.change.actions.includes('delete'),
  );
  const destroyed = [...new Set(deletions.map((resource) => resource.address))].sort();
  const unexpected = [
    ...new Set(
      deletions
        .filter(
          (resource) =>
            !allowedAddresses.has(resource.address) &&
            !(
              resource.change.actions.length === 1 &&
              RETIRED_NIBRUNNER_TLS_ADDRESSES.has(resource.address)
            ),
        )
        .map((resource) => resource.address),
    ),
  ].sort();
  return { destroyed, unexpected };
}
