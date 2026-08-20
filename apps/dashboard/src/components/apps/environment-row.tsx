import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { TableCell, TableRow } from '@repo/ui/components/table';
import { EyeIcon, EyeOffIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { HiddenValuePopover } from '#components/apps/hidden-value-popover.tsx';
import type { EnvironmentVariable } from '#lib/environment-variables.ts';

const HIDDEN_VALUE = '••••••••••••';

const SEALED = {
  title: 'Sealed',
  description:
    'This value was encrypted when it was set, and nothing here can read it back — not this page, and not nibrun. Replacing it is the only way to change what the app runs with.',
};

// A row is one line high, so a value with more than one in it can be carried and sent but never
// shown: an input would drop the line breaks the moment it was typed in.
const MANY_LINES = {
  title: 'Several lines',
  description:
    'This value spans several lines, which is more than a row can show. It is deployed exactly as the file had it; replace it to change what the app runs with.',
};

export function EnvironmentRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: EnvironmentVariable;
  onChange: (variable: EnvironmentVariable) => void;
  onRemove: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const named = variable.name.trim();
  const hidden = variable.sealed ? SEALED : variable.value.includes('\n') ? MANY_LINES : undefined;

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
            type={revealed ? 'text' : 'password'}
            value={variable.value}
            onChange={(event) => onChange({ ...variable, value: event.target.value })}
            aria-label={named === '' ? 'Variable value' : `Value of ${named}`}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        ) : (
          <span className="px-2.5 font-mono text-muted-foreground">{HIDDEN_VALUE}</span>
        )}
      </TableCell>
      <TableCell className="w-px p-1">
        <div className="flex items-center gap-0.5">
          {hidden === undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={revealed ? 'Hide the value' : 'Show the value'}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          ) : (
            <HiddenValuePopover
              name={named}
              title={hidden.title}
              description={hidden.description}
              onReplace={() => onChange({ ...variable, value: '', sealed: false })}
            />
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
