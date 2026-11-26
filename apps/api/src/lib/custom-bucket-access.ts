import { ForbiddenError } from '#lib/errors.ts';

export class CustomBucketsDisabledError extends ForbiddenError {
  constructor() {
    super(
      'Custom buckets are not enabled for your account. Open a request from “Use your bucket” on the app’s dashboard, or run `nib paid-request --type custom-bucket --app <app-name-or-slug>`.',
    );
  }
}
