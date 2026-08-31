import type { Writer } from '#lib/output.ts';

export type WriterRecording = Writer & {
  /** Every line a renderer wrote, in order. */
  said: string[];
  /** Which channel each of them went out on, so routing is assertable on its own. */
  at: string[];
};

/** Where a renderer writes, when what is being pinned down is what it wrote rather than to whom. */
export function writerRecording(): WriterRecording {
  const said: string[] = [];
  const at: string[] = [];

  function channel(name: string) {
    return (message: string) => {
      at.push(name);
      said.push(message);
    };
  }

  return {
    said,
    at,
    info: channel('info'),
    success: channel('success'),
    warn: channel('warn'),
    error: channel('error'),
    dim: channel('dim'),
    step: channel('step'),
    done: channel('done'),
  };
}
