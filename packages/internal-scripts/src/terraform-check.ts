import * as core from '@actions/core';
import { terraform } from '#shared/terraform.ts';

const formatted = await terraform(['fmt', '-check', '-recursive', '-diff']).nothrow();
if (formatted.exitCode !== 0) {
  core.setFailed(
    'Terraform files are not formatted. Run `terraform fmt -recursive infra/terraform`.',
  );
}

// -backend=false so this needs no credentials and no state: it only loads the
// providers pinned in the lock file.
await terraform(['init', '-backend=false', '-input=false']);
await terraform(['validate']);
