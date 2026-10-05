import { recordEntry, trackEvent } from '@repo/analytics';
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
