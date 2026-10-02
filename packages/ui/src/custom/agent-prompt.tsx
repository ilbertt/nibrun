import { BASE_DOMAIN } from '@repo/global-constants';
import { AgentPromptButton } from '@repo/ui/custom/agent-prompt-button';

const STARTER_REPO_URL = 'https://github.com/ilbertt/bun-full-stack-starter';
const AGENT_PROMPT = `Ask me what I want to build, then build it from ${STARTER_REPO_URL} and deploy it on ${BASE_DOMAIN}.`;

export function AgentPrompt({ onCopied }: { onCopied: (() => void) | undefined }) {
  return (
    <AgentPromptButton
      label="Create your app"
      prompt={AGENT_PROMPT}
      compact={false}
      onCopied={onCopied}
    />
  );
}
