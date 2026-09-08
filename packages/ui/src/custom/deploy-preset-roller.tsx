import { Button } from '@repo/ui/components/button';
import { useEffect, useState } from 'react';

const HOLD_MS = 2400;

/**
 * One button standing for every app that deploys in a click, with only the name rolling: what is
 * on offer is the deploy, and a list would say that once per row.
 *
 * The name a preset is written under is also the name of the binary it deploys, so it is the one
 * word here — the button is otherwise a sentence about the reader's own app.
 */
export function DeployPresetRoller<T extends string>({
  presets,
  linkToPreset,
}: {
  presets: readonly [T, ...T[]];
  /** Where each preset deploys from, as the site around this one addresses its own deploy screen. */
  linkToPreset: (preset: T) => React.ReactElement;
}) {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const rolling = presets[at] ?? presets[0];

  useEffect(() => {
    if (held) {
      return;
    }
    const roll = setInterval(() => setAt((shown) => (shown + 1) % presets.length), HOLD_MS);
    return () => clearInterval(roll);
  }, [held, presets.length]);

  return (
    <Button
      variant="outline"
      size="lg"
      render={linkToPreset(rolling)}
      // Held while it is under the cursor or on the keyboard: what the button deploys is whatever
      // it says right now, and a name that rolls on is one nobody meant to click.
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      Deploy your own
      {/* A window one line tall over a column of every name, so the button is as wide as the
          longest of them from the first frame and never resizes as they pass. The line is leaded
          past the label's, or the mono ascenders of the name below reach into the window. */}
      <span className="inline-flex h-[1lh] overflow-hidden leading-6">
        <span
          className="flex flex-col transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateY(calc(${at} * -1lh))` }}
        >
          {presets.map((preset) => (
            <span
              key={preset}
              className="text-center font-mono text-primary"
              aria-hidden={preset !== rolling}
            >
              {preset}
            </span>
          ))}
        </span>
      </span>
    </Button>
  );
}
