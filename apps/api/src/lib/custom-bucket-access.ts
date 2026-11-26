import { CUSTOM_BUCKETS_DISABLED_CODE } from '@repo/api-constants';
import { ForbiddenError } from '#lib/errors.ts';

export class CustomBucketsDisabledError extends ForbiddenError {
  constructor() {
    super(
      'Custom buckets are not enabled for your account. Open a request from “Use your bucket” on the app’s dashboard.',
    );
  }

  override get response() {
    return { error: this.message, code: CUSTOM_BUCKETS_DISABLED_CODE } as const;
  }
}
