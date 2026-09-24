import { WWW_SITE } from '@repo/global-constants';
import { Button } from '@repo/ui/components/button';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { CheckIcon, SparklesIcon } from 'lucide-react';
import { appDeployPath, appMarkdownPath, type CatalogApp } from '#lib/apps.ts';

/**
 * The prompt rather than the page: what an agent needs is this app's source and the address it
 * deploys from, and what the reader wants is to hand that over without reading it themselves.
 */
function agentPrompt(app: CatalogApp): string {
  return `Deploy ${app.title} on nibrun for me. Read ${WWW_SITE.url}${appMarkdownPath(app)} first, then open ${WWW_SITE.url}${appDeployPath(app)} and fill in whatever it asks for.`;
}

export function AskYourAgent({ app }: { app: CatalogApp }) {
  const { copied, copy } = useClipboardCopy(agentPrompt(app));

  return (
    <Button variant="outline" size="lg" onClick={copy}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
      {copied ? 'Prompt copied' : 'Ask your agent'}
    </Button>
  );
}
