import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { TableCell, TableRow } from '@repo/ui/components/table';
import { EyeIcon, EyeOffIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { SealedValuePopover } from '#components/apps/sealed-value-popover.tsx';
import type { EnvironmentVariable } from '#lib/environment-variables.ts';

const HIDDEN_VALUE = '••••••••••••';

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
        {variable.sealed ? (
          <span className="px-2.5 font-mono text-muted-foreground">{HIDDEN_VALUE}</span>
        ) : (
          <Input
            type={revealed ? 'text' : 'password'}
            value={variable.value}
            onChange={(event) => onChange({ ...variable, value: event.target.value })}
            aria-label={named === '' ? 'Variable value' : `Value of ${named}`}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </TableCell>
      <TableCell className="w-px p-1">
        <div className="flex items-center gap-0.5">
          {variable.sealed ? (
            <SealedValuePopover
              name={named}
              onReplace={() => onChange({ ...variable, value: '', sealed: false })}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={revealed ? 'Hide the value' : 'Show the value'}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
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
