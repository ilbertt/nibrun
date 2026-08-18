import { FilenameSchema, Value } from '@repo/protocol';
import { useState } from 'react';
import { appDestination, handOffBinary } from '#lib/handoff.ts';

export type BinaryHandoff = {
  binary: File | undefined;
  sending: boolean;
  failure: string | undefined;
  offer: (binary: File | undefined) => void;
};

export function useBinaryHandoff(): BinaryHandoff {
  const [binary, setBinary] = useState<File>();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();

  function offer(dropped: File | undefined): void {
    if (dropped === undefined) {
      return;
    }

    setBinary(dropped);
    setFailure(undefined);

    // Rejected here rather than on the far side, so a name the app could never write into an
    // export is refused while the person is still looking at the file they picked.
    if (!Value.Check(FilenameSchema, dropped.name)) {
      setFailure('That file cannot be named inside an export. Rename it and drop it again.');
      return;
    }

    setSending(true);
    handOffBinary(dropped)
      .then(function goToApp() {
        window.location.href = appDestination();
      })
      .catch(function reportFailure(error: Error) {
        setSending(false);
        setFailure(error.message);
      });
  }

  return { binary, sending, failure, offer };
}
