import { Data } from 'effect';

export class VolumeMigrationFenceBusy extends Data.TaggedError('VolumeMigrationFenceBusy') {
  override get message() {
    return 'A volume storage migration already owns this app.';
  }
}
