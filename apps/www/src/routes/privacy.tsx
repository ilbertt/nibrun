import { SUPPORT_EMAIL, WWW_PRIVACY_PATH } from '@repo/global-constants';
import { createFileRoute } from '@tanstack/react-router';
import { ContentPage } from '#components/content-page.tsx';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';

const TITLE = 'Privacy policy';
const DESCRIPTION =
  'What nibrun processes, why it is needed, and how to contact us about your data.';

export const Route = createFileRoute('/privacy')({
  head: () =>
    pageHead({ path: WWW_PRIVACY_PATH, title: pageTitle(TITLE), description: DESCRIPTION }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <ContentPage title={TITLE} description={DESCRIPTION}>
      <p>
        Last updated: <time dateTime="2026-10-19">19 October 2026</time>.
      </p>
      <p>
        In this policy, “nibrun”, “we”, “us”, and “our” refer to the operator of the nibrun service.
      </p>
      <p>
        This policy covers the nibrun website, dashboard, CLI, and MCP integration. For privacy
        questions or requests, contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2>Information we process</h2>
      <ul>
        <li>
          <strong>Account and sign-in information.</strong> When you sign in with GitHub, we receive
          account identifiers, your name, email address, and profile image. We store authentication
          records, sessions, tokens, and connection information, which can include IP addresses and
          browser details. Anonymous sessions let us associate a temporary app with its creator
          before sign-in.
        </li>
        <li>
          <strong>Your apps.</strong> We process uploaded executables, app settings, environment
          variables, deployment history, persistent files and databases, imports, exports, logs, and
          resource-usage information to host and operate your apps.
        </li>
        <li>
          <strong>Connected assistants.</strong> MCP requests can include app identifiers,
          deployment files or download URLs, configuration, SQL queries, and client or conversation
          references. Requested results, such as logs or database rows, are returned to the client
          you connected. They can contain personal information from your apps.
        </li>
        <li>
          <strong>Support messages.</strong> We receive your email address and the information you
          choose to send when you contact us.
        </li>
        <li>
          <strong>Website and dashboard activity.</strong> We collect page views, navigation, device
          and browser information, performance measurements, and events such as sign-in and
          deployment outcomes. Analytics can associate an opaque visitor identifier with your nibrun
          account ID. Session replay records interactions with the website and dashboard.
        </li>
      </ul>

      <h2>How we use information</h2>
      <p>
        We use this information to authenticate you, run your apps, persist and export their data,
        carry out requests from connected tools, provide support, investigate failures and abuse,
        secure the service, and understand how the website and dashboard are used.
      </p>
      <p>
        If your app collects personal information, you are responsible for deciding what it collects
        and how it is used, providing the appropriate notices, and responding to your users. This
        policy does not replace the privacy notice for an app you operate.
      </p>

      <h2>Cookies and analytics</h2>
      <p>
        Sign-in uses session cookies. Website and dashboard analytics use a visitor-identifier
        cookie that lasts up to 90 days and a navigation-context cookie that lasts up to 30 minutes.
        These analytics cookies are shared between nibrun.com and app.nibrun.com.
      </p>
      <p>
        Analytics and session replay use our self-hosted Umami installation. The nibrun analytics
        integration does not load when your browser sends Do Not Track with the value 1. You can
        also block the analytics host through your browser. Clearing cookies resets the browser
        identifier; it does not erase records already stored on the server.
      </p>
      <p>
        Analytics events exclude names, email addresses, configuration values, and non-marketing
        query parameters. Session replay is a separate recording of page interactions. Our website
        analytics integration is not automatically installed in apps you host on nibrun.
      </p>

      <h2>Service providers and connected services</h2>
      <p>
        nibrun uses Amazon Web Services for application hosting and storage, Cloudflare for website
        delivery, HTTPS traffic, and domain services, and GitHub for sign-in. Support messages are
        processed through email. These providers process information needed for their role in
        delivering the service.
      </p>
      <p>
        Application hosting and persistent storage are based in Frankfurt, Germany. Requests can
        pass through Cloudflare’s global network. GitHub and any AI provider you connect handle
        information under their own terms and privacy policies; their processing may take place in
        other countries.
      </p>
      <p>
        Connecting an AI client authorizes it to request information and perform supported actions
        on your account. Information returned to that client leaves nibrun and is handled by that
        service. Disconnecting a client does not delete your apps or copies already received by that
        client.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        App files and configuration remain available while the app is retained. Deleting an app
        starts its teardown and cleanup. Removal is asynchronous, and stored versions or backups can
        outlive removal from the active service.
      </p>
      <ul>
        <li>
          Temporary binary uploads and downloadable exports are configured to expire after one day.
        </li>
        <li>Imported data archives are configured to expire after 30 days.</li>
        <li>Service and application logs are configured to expire after 30 days.</li>
        <li>Platform database backups are configured to expire after 90 days.</li>
        <li>Daily infrastructure snapshots retain the most recent 14 copies.</li>
      </ul>
      <p>
        Storage expiry is performed by background processes and is not an immediate erasure
        guarantee. Analytics records and stored binary versions currently have no automatic expiry.
        Contact us about account closure or removal of information retained outside an active app.
        Any retention required by applicable law still applies.
      </p>

      <h2>Your choices and requests</h2>
      <p>
        You can export or delete apps using the dashboard or CLI. Contact us to request account
        closure or access, correction, deletion, or a copy of personal information. Depending on the
        law that applies to you, you may also have rights to object to or restrict processing and to
        complain to a data-protection authority. We may need to verify your identity before
        fulfilling a request.
      </p>
      <p>
        Send requests to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Requests about
        data collected by an app hosted on nibrun should normally go to that app’s operator.
      </p>
    </ContentPage>
  );
}
