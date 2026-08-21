import { OwnedAppStateSchema } from '@repo/protocol';
import { t } from 'elysia';

// What state the app should be in, rather than an instruction to stop or start it: the host is
// never sent either, and reads what it should be running off this. Narrowed to the two an owner
// moves an app between, so a request cannot ask for a deletion or claim one is finished.
export const AppStateRequestSchema = t.Object(
  { state: OwnedAppStateSchema },
  { additionalProperties: false },
);
