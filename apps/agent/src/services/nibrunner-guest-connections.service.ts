import { NIBRUNNER_GUEST_CONNECTIONS_SOCKET } from '@repo/global-constants';
import { Effect } from 'effect';
import { connectNibrunnerGuest } from '#lib/nibrunner/guest-connection.ts';

export class NibrunnerGuestConnections extends Effect.Service<NibrunnerGuestConnections>()(
  'NibrunnerGuestConnections',
  {
    succeed: {
      connect: (input: Omit<Parameters<typeof connectNibrunnerGuest>[0], 'socketPath'>) =>
        connectNibrunnerGuest({ ...input, socketPath: NIBRUNNER_GUEST_CONNECTIONS_SOCKET }),
    },
  },
) {}
