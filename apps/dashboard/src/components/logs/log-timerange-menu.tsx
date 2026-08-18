import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDownIcon } from 'lucide-react';
import { useLogTimerange } from '#lib/hooks/use-log-timerange.ts';
import { LOG_TIMERANGES, type LogTimerangeChoice } from '#lib/log-timeranges.ts';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export function LogTimerangeMenu() {
  const timerange = useLogTimerange();
  const navigate = useNavigate({ from: LogsRoute.fullPath });
  const selected = LOG_TIMERANGES.find((choice) => choice.value === timerange);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        {selected?.label}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44" align="end">
        <DropdownMenuRadioGroup
          value={timerange}
          onValueChange={(value: LogTimerangeChoice) => {
            void navigate({ search: { timerange: value } });
          }}
        >
          {LOG_TIMERANGES.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
