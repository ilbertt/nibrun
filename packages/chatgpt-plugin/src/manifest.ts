import {
  GITHUB_REPO_URL,
  PRODUCT_NAME,
  WWW_PRIVACY_PATH,
  WWW_SITE,
  WWW_SUPPORT_PATH,
  WWW_TERMS_PATH,
} from '@repo/global-constants';
import { reviewCases } from '#review-cases.ts';
import packageJson from '../package.json' with { type: 'json' };

export function createManifest() {
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
          shortDescription: 'Build an app. Keep it yours.',
          longDescription:
            'Describe your idea and turn it into a working app with your AI assistant. Get it online without servers or separate databases to manage. Keep improving it through conversation, switch assistants whenever you choose, and export your app and data when you want to take them elsewhere. Your app stays yours.',
          category: 'Productivity',
          capabilities: [],
          defaultPrompt: [
            'Create an email signup page for my tennis club.',
            'Build a booking app for my tutoring sessions where students can choose an available time.',
            'Build a Telegram bot that saves links I send and lets me search them later.',
          ],
          websiteURL: WWW_SITE.url,
          supportURL: new URL(WWW_SUPPORT_PATH, WWW_SITE.url).href,
          privacyPolicyURL: new URL(WWW_PRIVACY_PATH, WWW_SITE.url).href,
          termsOfServiceURL: new URL(WWW_TERMS_PATH, WWW_SITE.url).href,
          logo: './assets/logo.png',
          composerIcon: './assets/composer-icon.png',
        },
        requires_local_executor: false,
        review: { test_cases: reviewCases },
      },
    },
  };
}
