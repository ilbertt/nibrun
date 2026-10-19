import { GITHUB_REPO_URL, HELLO_EMAIL, WWW_SUPPORT_PATH } from '@repo/global-constants';
import { createFileRoute } from '@tanstack/react-router';
import { ContentPage } from '#components/content-page.tsx';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';

const TITLE = 'Support';
const DESCRIPTION = 'Help with your account, apps, and data.';

export const Route = createFileRoute('/support')({
  head: () =>
    pageHead({ path: WWW_SUPPORT_PATH, title: pageTitle(TITLE), description: DESCRIPTION }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <ContentPage title={TITLE} description={DESCRIPTION}>
      <h2>Get in touch</h2>
      <p>
        Email <a href={`mailto:${HELLO_EMAIL}`}>{HELLO_EMAIL}</a> for help with nibrun, account
        access, deployments, or privacy requests.
      </p>
      <p>
        For an app problem, include its name or public URL, what you expected to happen, what
        happened instead, and when it happened. Remove passwords, API keys, environment-variable
        values, and personal data from any logs or screenshots you send.
      </p>

      <h2>Report a bug</h2>
      <p>
        You can also <a href={`${GITHUB_REPO_URL}/issues`}>open an issue on GitHub</a> for a
        reproducible bug or feature request. GitHub issues are public. Send account details,
        security reports, and private app information by email instead.
      </p>

      <h2>Your apps and data</h2>
      <p>
        You can export an app from the dashboard or CLI. An export contains its executable,
        persistent files, and environment configuration. Keep a separate copy of your project’s
        source code and store exports securely.
      </p>
      <p>
        To request account closure or access, correction, or deletion of personal data, email us
        from the address associated with your account. We may need to verify that the account or app
        belongs to you before acting.
      </p>
    </ContentPage>
  );
}
