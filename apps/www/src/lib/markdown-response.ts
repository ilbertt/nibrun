import { LLMS_TXT_PATH, PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import { APPS, appDeployPath, CATALOG, type CatalogApp, findApp } from '#lib/apps.ts';
import { findPost } from '#lib/blog.ts';

const BLOG_PATH = /^\/blog\/([a-z0-9-]+)\.md$/;
const APP_PATH = /^\/apps\/([a-z0-9-]+)\.md$/;
const OWN_APP_POINTER = `Deploying an app of your own? ${WWW_SITE.url}${LLMS_TXT_PATH} has the instructions, the CLI
and the agent skill.`;

/**
 * Every page is prerendered to a static file and served from the edge, but a `.md` prerendered
 * alongside them would be handed back with whatever content type the extension is guessed to
 * mean — and being read as markdown rather than downloaded is the entire point of the URL.
 */
export function markdownResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url);
  const body = written(pathname);

  return body === undefined
    ? undefined
    : new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}

function written(pathname: string): string | undefined {
  if (pathname === CATALOG.markdownPath) {
    return catalog();
  }

  const post = BLOG_PATH.exec(pathname)?.[1];
  if (post !== undefined) {
    return findPost(post)?.markdown;
  }

  const slug = APP_PATH.exec(pathname)?.[1];
  const app = slug === undefined ? undefined : findApp(slug);
  return app === undefined ? undefined : appPage(app);
}

/**
 * On the page, what nibrun is and where the deploy starts are the layout and its buttons. A reader
 * handed only the text gets them written out around the app's own copy instead.
 */
function appPage(app: CatalogApp): string {
  return `# Deploy ${app.title} on ${PRODUCT_NAME}

> ${app.subtitle}

[${PRODUCT_NAME}](${WWW_SITE.url}) deploys a single compiled binary in one click. ${app.title} gets
a microVM of its own, a persistent filesystem at \`data/\`, and an HTTPS URL.

- Deploy on ${PRODUCT_NAME}: ${WWW_SITE.url}${appDeployPath(app)}
- Repository: ${app.repositoryUrl}
- Version: \`${app.version}\`

${app.markdownContent.trimEnd()}

---

${OWN_APP_POINTER}
`;
}

/**
 * The catalog itself, which has no file behind it — the index is a route rendered from the set,
 * so the Markdown it reads as is written from the same set rather than kept in step by hand.
 */
function catalog(): string {
  const rows = APPS.map(
    (app) =>
      `- [${app.title}](/apps/${app.slug}) — ${app.subtitle} \`${app.category}\`, \`${app.repositoryUrl}\`, \`${app.version}\``,
  );

  return `# ${CATALOG.heading}

Open source apps that already ship a single binary, deployed straight from their release assets.
Each one runs in a microVM of its own: 1 vCPU, 256 MiB, and an 8 GiB volume at \`data/\`.

${rows.join('\n')}

Every app above has a page at \`/apps/<slug>\`, which also serves as Markdown at
\`/apps/<slug>.md\`, and deploys from \`/deploy/<slug>\`.

${OWN_APP_POINTER}
`;
}
