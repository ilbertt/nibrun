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
import type { ReactNode } from 'react';
import { EnvironmentRow } from '#components/apps/environment-row.tsx';
import { blankVariable, type EnvironmentVariable } from '#lib/environment-variables.ts';

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
        A value may name one the guest sets, like{' '}
        {/* biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being documented, shown to the reader rather than interpolated */}
        <code className="font-mono">{'${NIBRUN_HOSTNAME}'}</code>.
      </p>
    </div>
  );
}
