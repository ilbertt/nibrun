import { Data } from 'effect';

export class VolumeMigrationFenceBusy extends Data.TaggedError('VolumeMigrationFenceBusy') {
  override get message() {
    return 'A volume storage migration already owns this app.';
  }
}

export class VolumeMigrationFenceRequired extends Data.TaggedError('VolumeMigrationFenceRequired') {
  override get message() {
    return 'Destination preparation requires exclusive volume migration ownership.';
  }
}
