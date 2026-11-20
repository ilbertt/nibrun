import { Data } from 'effect';

export class UnsupportedNibrunnerFeature extends Data.TaggedError('UnsupportedNibrunnerFeature')<{
  readonly feature: string;
}> {
  override get message() {
    return `The nibrunner bridge does not support ${this.feature}.`;
  }
}

export class NibrunnerReportMismatch extends Data.TaggedError('NibrunnerReportMismatch')<{
  readonly reason: string;
}> {
  override get message() {
    return `The nibrunner report ${this.reason}.`;
  }
}
