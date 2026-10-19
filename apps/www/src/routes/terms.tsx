import { SUPPORT_EMAIL, WWW_PRIVACY_PATH, WWW_TERMS_PATH } from '@repo/global-constants';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ContentPage } from '#components/content-page.tsx';
import { pageHead } from '#lib/page-head.ts';
import { pageTitle } from '#lib/page-title.ts';

const TITLE = 'Terms of service';
const DESCRIPTION = 'The terms for using nibrun to host and manage your apps.';

export const Route = createFileRoute('/terms')({
  head: () => pageHead({ path: WWW_TERMS_PATH, title: pageTitle(TITLE), description: DESCRIPTION }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <ContentPage title={TITLE} description={DESCRIPTION}>
      <p>
        Last updated: <time dateTime="2026-10-19">19 October 2026</time>.
      </p>
      <p>
        These terms apply to your use of the nibrun website, dashboard, CLI, MCP server, and hosting
        service. By using nibrun, you agree to these terms. If you use nibrun on behalf of an
        organisation, you must have authority to accept them for that organisation.
      </p>

      <h2>The service</h2>
      <p>
        nibrun runs uploaded executables in isolated environments with persistent storage and
        provides tools to deploy, inspect, export, and delete apps. Resource limits, supported
        features, and any fees are described in the service and on the{' '}
        <Link to="/" hash="pricing">
          pricing page
        </Link>
        . Paid services are subject to the pricing and billing terms agreed when you purchase them.
      </p>

      <h2>Your account and connected tools</h2>
      <p>
        Keep access to your account and authentication credentials secure. You are responsible for
        activity you authorise, including actions performed by connected AI assistants or deployment
        tools. Review their access and disconnect them when you no longer want them acting on your
        account.
      </p>
      <p>
        Deploying an update replaces the app’s current release. Changes made by an assistant have
        the same effect as changes you make yourself. AI-generated code can contain mistakes; review
        and test it before relying on it.
      </p>

      <h2>Your apps and data remain yours</h2>
      <p>
        These terms do not transfer ownership of your code, files, or data to nibrun. You must own
        them or have permission to use them. You give nibrun the permission needed to store,
        execute, copy, back up, and transmit them to provide and support the service.
      </p>
      <p>
        You can export an app’s executable, persistent files, and environment configuration. Keep
        your own copy of the source code: an executable export does not reconstruct the project that
        produced it. Third-party software remains subject to its own licences.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not use nibrun for unlawful activity, malware, phishing, unsolicited bulk messaging,
        unauthorised access, or attacks against other systems. Do not bypass account or resource
        limits, interfere with the service, or attempt to access another user’s apps, data, or
        credentials.
      </p>
      <p>
        You are responsible for the behaviour and security of your apps, the information they
        collect, and compliance with applicable law and third-party rights. Hosting isolation does
        not supply authentication or access controls for your app’s own users.
      </p>

      <h2>Availability and backups</h2>
      <p>
        Unless a separate written agreement says otherwise, nibrun is provided as available, without
        a guaranteed service level. Maintenance, failures, and changes can interrupt service.
        Persistent storage is not a substitute for an independent backup. Export and keep copies of
        anything you cannot afford to lose.
      </p>
      <p>
        Nothing in these terms excludes responsibilities or limits rights that cannot lawfully be
        excluded or limited, including applicable consumer rights.
      </p>

      <h2>Suspension and ending use</h2>
      <p>
        We may suspend or remove apps or access when needed to address abuse, security risks,
        unlawful activity, or violations of these terms. You can stop using the service, delete your
        apps, and contact us to request account closure. Deletion and backup retention are described
        in the <Link to={WWW_PRIVACY_PATH}>privacy policy</Link>.
      </p>

      <h2>Privacy and questions</h2>
      <p>
        The <Link to={WWW_PRIVACY_PATH}>privacy policy</Link> explains how nibrun processes
        information and how to make a privacy request. These terms may be updated on this page with
        a revised date. Contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with
        questions about the service or these terms.
      </p>
    </ContentPage>
  );
}
