import { recordEntry, trackEvent } from '@repo/analytics';
import { FilenameSchema } from '@repo/api-client/validation';
import { Value } from '@sinclair/typebox/value';
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
    recordEntry({ entry_source: 'binary-drop', preset_slug: undefined });
    trackEvent({ name: 'binary_selected', data: { size_bytes: dropped.size } });
    setFailure(undefined);

    // Rejected here rather than on the far side, so a name the app could never write into an
    // export is refused while the person is still looking at the file they picked.
    if (!Value.Check(FilenameSchema, dropped.name)) {
      trackEvent({ name: 'binary_handoff_failed', data: { phase: 'validation' } });
      setFailure('That file cannot be named inside an export. Rename it and drop it again.');
      return;
    }

    setSending(true);
    handOffBinary(dropped)
      .then(function goToApp() {
        window.location.href = appDestination();
      })
      .catch(function reportFailure(error: Error) {
        trackEvent({ name: 'binary_handoff_failed', data: { phase: 'handoff' } });
        setSending(false);
        setFailure(error.message);
      });
  }

  return { binary, sending, failure, offer };
}
