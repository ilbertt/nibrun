import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { McpMark } from '@repo/ui/custom/mcp-mark';
import type { DeploymentSummary } from '#queries/deployments.ts';

export function McpDeploymentOrigin({ mcp }: { mcp: NonNullable<DeploymentSummary['mcp']> }) {
  const label = `Deployed via MCP: ${mcp.clientId}${mcp.chatId === undefined ? '' : ` · Chat ID: ${mcp.chatId}`}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" aria-label={label}>
            <McpMark className="size-3" />
          </button>
        }
        className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
      />
      <TooltipContent className="break-all">{label}</TooltipContent>
    </Tooltip>
  );
}
