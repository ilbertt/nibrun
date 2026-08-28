import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUE_NAMES, writtenRuntimeValue } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { PlusIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { EnvironmentRow } from '#components/apps/environment-row.tsx';
import { blankVariable, type EnvironmentVariable } from '#lib/environment-variables.ts';

// Named rather than "the last two": they are second and fifth in the list above, and a reader
// counting from the wrong end sets a variable the deploy then refuses.
const PORT_VALUE_NAMES = EXTRA_PUBLIC_PORT_VALUES.map((value) =>
  writtenRuntimeValue(value.name),
).join(' and ');

function separatorBefore(index: number): string {
  return index === RUNTIME_VALUE_NAMES.length - 1 ? ' or ' : ', ';
}

export function EnvironmentTable({
  variables,
  onChange,
  children,
}: {
  variables: readonly EnvironmentVariable[];
  onChange: (variables: EnvironmentVariable[]) => void;
  children?: ReactNode;
}) {
  function replace(replacement: EnvironmentVariable): void {
    onChange(
      variables.map((variable) => (variable.id === replacement.id ? replacement : variable)),
    );
  }

  function remove(id: string): void {
    onChange(variables.filter((variable) => variable.id !== id));
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-1 font-normal text-muted-foreground text-xs">Name</TableHead>
            <TableHead className="px-1 font-normal text-muted-foreground text-xs">Value</TableHead>
            <TableHead className="w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {variables.map((variable) => (
            <EnvironmentRow
              key={variable.id}
              variable={variable}
              onChange={replace}
              onRemove={() => remove(variable.id)}
            />
          ))}
          {variables.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="whitespace-normal px-1 text-muted-foreground">
                Nothing set — the binary runs with whatever the guest gives it.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...variables, blankVariable()])}
        >
          <PlusIcon data-icon="inline-start" />
          Add a variable
        </Button>
        {children}
      </div>
      <p className="text-muted-foreground text-xs">
        A value may name one the guest sets, and nothing else:{' '}
        {[...RUNTIME_VALUE_NAMES.entries()].map(([index, name]) => (
          <Fragment key={name}>
            {index > 0 && separatorBefore(index)}
            <code className="font-mono">{writtenRuntimeValue(name)}</code>
          </Fragment>
        ))}
        . {PORT_VALUE_NAMES} only on an app with an additional port.
      </p>
    </div>
  );
}
