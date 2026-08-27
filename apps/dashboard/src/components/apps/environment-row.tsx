import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { TableCell, TableRow } from '@repo/ui/components/table';
import { PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { EnvironmentVariable } from '#lib/environment-variables.ts';

const HIDDEN_VALUE = '••••••••••••';

const SEALED = 'Already set. Replacing it is the only way to change what the app runs with.';

// A row is one line high, so a value with more than one in it can be carried and sent but never
// shown: an input would drop the line breaks the moment it was typed in.
const MANY_LINES =
  'This value spans several lines, which is more than a row can show. It is deployed exactly as the file had it; replace it to change what the app runs with.';

/** What replacing a value took the row away from, so that giving up on it puts the row back. */
type Kept = Pick<EnvironmentVariable, 'value' | 'sealed'>;

export function EnvironmentRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: EnvironmentVariable;
  onChange: (variable: EnvironmentVariable) => void;
  onRemove: () => void;
}) {
  const [kept, setKept] = useState<Kept | undefined>(undefined);
  const named = variable.name.trim();
  const hidden = variable.sealed ? SEALED : variable.value.includes('\n') ? MANY_LINES : undefined;

  function replace(): void {
    setKept({ value: variable.value, sealed: variable.sealed });
    onChange({ ...variable, value: '', sealed: false });
  }

  function keep(restored: Kept): void {
    setKept(undefined);
    onChange({ ...variable, ...restored });
  }

  // A stored variable is identified by its name, so renaming one would be removing it and adding
  // another under a name whose value nobody can supply.
  return (
    <TableRow>
      <TableCell className="w-1/2 p-1">
        <Input
          value={variable.name}
          onChange={(event) => onChange({ ...variable, name: event.target.value })}
          disabled={variable.sealed}
          placeholder="NAME"
          aria-label="Variable name"
          title={variable.name}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </TableCell>
      <TableCell className="w-1/2 p-1">
        {hidden === undefined ? (
          <Input
            value={variable.value}
            onChange={(event) => onChange({ ...variable, value: event.target.value })}
            aria-label={named === '' ? 'Variable value' : `Value of ${named}`}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        ) : (
          <span className="px-2.5 font-mono text-muted-foreground" title={hidden}>
            {HIDDEN_VALUE}
          </span>
        )}
      </TableCell>
      <TableCell className="w-px p-1">
        <div className="flex items-center gap-0.5">
          {kept !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={named === '' ? 'Keep the value it had' : `Keep the value ${named} had`}
              onClick={() => keep(kept)}
            >
              <XIcon />
            </Button>
          )}
          {hidden !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={named === '' ? 'Replace the value' : `Replace the value of ${named}`}
              onClick={replace}
            >
              <PencilIcon />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={named === '' ? 'Remove this variable' : `Remove ${named}`}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
