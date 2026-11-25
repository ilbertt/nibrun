import { Value } from '@sinclair/typebox/value';
import { McpDeploymentSchema } from '#lib/api/deployment.ts';

export function deploymentChatId({
  chatId,
  sessionId,
}: {
  chatId: string | undefined;
  sessionId: unknown;
}) {
  return (
    chatId ??
    (Value.Check(McpDeploymentSchema.properties.chatId, sessionId) ? sessionId : undefined)
  );
}
