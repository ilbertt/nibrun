import { useEffect, useState } from 'react';
import { readHandedOffBinary } from '#lib/handoff-store.ts';

export type HandedOffBinary = {
  binary: File | undefined;
  loading: boolean;
};

export function useHandedOffBinary(): HandedOffBinary {
  const [binary, setBinary] = useState<File>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    readHandedOffBinary()
      .then(function keep(stored) {
        if (live) {
          setBinary(stored);
          setLoading(false);
        }
      })
      .catch(function giveUp() {
        if (live) {
          setLoading(false);
        }
      });

    return () => {
      live = false;
    };
  }, []);

  return { binary, loading };
}
