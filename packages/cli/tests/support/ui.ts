import type { Ui } from '#lib/ui.ts';

/** Every line a command put on screen, in the order it put them there. */
export function uiRecording(): Ui & { said: string[] } {
  const said: string[] = [];

  return {
    said,
    open: () => {},
    step: (message) => said.push(message),
    done: (message) => said.push(message),
    waitingFor: ({ task }) => task(() => {}),
  };
}
