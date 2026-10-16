import { GITHUB_REPO_URL, PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import packageJson from '../package.json' with { type: 'json' };

export function createManifest({ appId }: { appId: string | undefined }) {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: PRODUCT_NAME,
    version: packageJson.version,
    description: packageJson.description,
    homepage: WWW_SITE.url,
    repository: GITHUB_REPO_URL,
    extensions: {
      'com.openai': {
        interface: {
          displayName: PRODUCT_NAME,
          shortDescription: 'Build and deploy web apps',
          longDescription:
            'Create and deploy apps to your connected nibrun account. When you have not chosen a stack, start webapps from the Bun full-stack starter or Telegram bots from the Bun Telegram starter. Compile a self-contained Linux x86_64 executable, deploy it through nibrun, and check its deployment status and HTTPS URL. You can also list your apps and inspect their configuration and newest deployment.',
          category: 'Other',
          capabilities: [],
          defaultPrompt: [
            'Create a webapp for my tennis club that collects emails for a future newsletter.',
            'Show my nibrun apps.',
            'Deploy the app I just built to nibrun.',
          ],
          websiteURL: WWW_SITE.url,
          logo: './assets/logo.png',
          composerIcon: './assets/composer-icon.png',
        },
        ...(appId === undefined ? {} : { apps: './.app.json', requires_local_executor: false }),
      },
    },
  };
}
