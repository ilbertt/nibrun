import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 1100;
const ROLL_MS = 280;

/**
 * One button standing for every app that deploys in a click, with only the name rolling: what is
 * on offer is the deploy, and a list would say that once per row. The list is still there, behind
 * the chevron, for a reader who knows which one they want and will not wait for it to come round.
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
  const [rolled, setRolled] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [held, setHeld] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const key = useRef<HTMLDivElement>(null);
  const at = rolled % presets.length;
  const shown = presets[at] ?? presets[0];

  useEffect(() => {
    if (held || choosing || rolling) {
      return;
    }
    const hold = setTimeout(() => setRolling(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, [held, choosing, rolling]);

  // Landed rather than watched for: a transition that never ends — a tab in the background, a
  // reader who asked for no motion — would be a name that never rolls again.
  useEffect(() => {
    if (!rolling) {
      return;
    }
    const land = setTimeout(() => {
      setRolled((count) => count + 1);
      setRolling(false);
    }, ROLL_MS);
    return () => clearTimeout(land);
  }, [rolling]);

  // Held between rolls while either half is under the cursor or on the keyboard, so what the
  // button deploys is the name standing still on it. A roll already under way finishes: stopping
  // one half way would park the window between two names.
  const holding = {
    onMouseEnter: () => setHeld(true),
    onMouseLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };

  return (
    // One key, not two: the halves are `ghost` and have no face of their own, so the shell wears
    // the `outline` variant's — same edge, same radius, same base as every other button on the
    // page. `:active` reaches here from whichever half is pressed.
    <div
      ref={key}
      className="key-face flex items-center rounded-2xl border border-border bg-background dark:bg-transparent"
    >
      <Button
        variant="ghost"
        size="lg"
        render={linkToPreset(shown)}
        className="rounded-r-none pr-3"
        {...holding}
      >
        Deploy your own
        {/* A window one line tall over a column of every name, so the button is as wide as the
            longest of them from the first frame and never resizes as they pass. The line is leaded
            past the label's, or the mono ascenders of the name below reach into the window. */}
        <span className="inline-flex h-[1lh] overflow-hidden leading-6">
          {/* The column starts at the name on show and is replaced, once the roll has landed, by one
              starting at the name it landed on — the same picture, so the roll goes on downwards
              forever instead of winding back up to the top of a fixed list. */}
          <span
            key={rolled}
            className="flex flex-col transition-transform ease-out motion-reduce:transition-none"
            style={{
              transitionDuration: `${ROLL_MS}ms`,
              transform: rolling ? 'translateY(-1lh)' : undefined,
            }}
          >
            {rotated({ presets, at }).map((preset) => (
              <span
                key={preset}
                className="text-center font-mono text-primary"
                aria-hidden={preset !== shown}
              >
                {preset}
              </span>
            ))}
          </span>
        </span>
      </Button>
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      {/* Held too while the list is open: the cursor has left the key for the list, and the name
          on the key is the one the reader is choosing against. */}
      <DropdownMenu open={choosing} onOpenChange={setChoosing}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Choose what to deploy"
              className="rounded-l-none"
              {...holding}
            />
          }
        >
          <ChevronDownIcon
            className={`transition-transform duration-200 ${choosing ? 'rotate-180' : ''}`}
          />
        </DropdownMenuTrigger>
        {/* Hung from the whole key rather than the chevron that opens it: the list is as wide as the
            key, and every name on it fits on one line as the one on the key does. */}
        <DropdownMenuContent anchor={key} align="end">
          {presets.map((preset) => (
            <DropdownMenuItem key={preset} render={linkToPreset(preset)} className="font-mono">
              {preset}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function rotated<T extends string>({
  presets,
  at,
}: {
  presets: readonly T[];
  at: number;
}): readonly T[] {
  return [...presets.slice(at), ...presets.slice(0, at)];
}
