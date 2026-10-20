import { MCP_TOOL_NAMES } from '@repo/api-constants';

export const reviewCases = {
  positive: [
    {
      description:
        'Create a webapp from a natural-language request. Requires a connected demo account with capacity for two new apps across the creation cases.',
      prompt: 'Create an email signup page for my tennis club.',
      tools_triggered: [MCP_TOOL_NAMES.deployApp, MCP_TOOL_NAMES.getApp].join(', '),
      expected_behavior:
        'Read setup-app, follow its default Bun webapp template and template instructions, then read deploy-to-nibrun. Build a self-contained Linux x86_64 executable and deploy it to a new app. Return the app ID and public URL after checking the deployment status and an HTTP response. A signup submitted through the app API must be stored persistently.',
    },
    {
      description:
        'Update the webapp from the creation case. Continue in the same chat so its source is available. Before running, submit a test subscriber and retain its details for comparison.',
      prompt: 'Add a first-name field to the tennis app. Keep existing subscribers.',
      tools_triggered: [MCP_TOOL_NAMES.getApp, MCP_TOOL_NAMES.deployApp].join(', '),
      expected_behavior:
        'Redeploy the existing app ID and return its URL after checking the new deployment. The updated signup accepts a first name, the previously stored subscriber remains present, and no duplicate app is created.',
    },
    {
      description:
        'Inspect the connected account after the webapp cases. Compare the results with the app IDs and deployment returned by those cases.',
      prompt: 'List my apps and show the tennis app’s URL and deployment status.',
      tools_triggered: [MCP_TOOL_NAMES.listApps, MCP_TOOL_NAMES.getApp].join(', '),
      expected_behavior:
        'List only the connected account’s apps, identify the tennis app, and report its ID, public URL, and current deployment status from the tool results. Do not create or redeploy an app.',
    },
    {
      description:
        'Diagnose a prepared signup-diagnostics fixture in a fresh chat. Requires a running newsletter app with exactly three stored subscribers and a failed signup request that logged "Signup storage unavailable".',
      prompt:
        'Find why the latest signup failed in signup-diagnostics. Find its database file and check how many subscribers were saved. Don’t change any data.',
      tools_triggered: [
        MCP_TOOL_NAMES.getApp,
        MCP_TOOL_NAMES.readLogs,
        MCP_TOOL_NAMES.listFiles,
        MCP_TOOL_NAMES.queryDatabase,
      ].join(', '),
      expected_behavior:
        'Find the logged storage error, locate the app’s SQLite database through its file listing, and use read-only SQL to report three subscribers. Ground the diagnosis in the returned logs without claiming an unverified root cause. Preserve the stored data and deployment.',
    },
    {
      description:
        'Create a Telegram bot using a pre-created test bot whose credentials and test access are supplied privately with reviewer access. The reviewer must not need to register a bot.',
      prompt: 'Build a Telegram bot that saves links I send and lets me search them.',
      tools_triggered: [MCP_TOOL_NAMES.deployApp, MCP_TOOL_NAMES.getApp].join(', '),
      expected_behavior:
        'Read setup-app and use its Bun Telegram bot template, then follow deploy-to-nibrun to compile and deploy with the supplied test bot credentials. Verify the deployment. A link sent to the test bot can be found through its search command and is saved on persistent storage. Keep the bot token out of the response and source archive.',
    },
  ],
  negative: [
    {
      description:
        'App deletion is outside the current MCP tool surface. Use the tennis app from the positive cases. Expect an explanation of the limitation and directions to the dashboard. The agent must not create or redeploy an app as a deletion workaround, erase data, or claim that deletion succeeded.',
      prompt: 'Delete the tennis app and all its data.',
    },
    {
      description:
        'Domain purchasing is outside the current MCP tool surface. Expect an explanation that the connection cannot purchase domains and domain-provider or setup guidance. The agent must not initiate a deployment or claim that a purchase occurred.',
      prompt: 'Buy a domain for my tennis app.',
    },
    {
      description:
        'Repository writes are outside the current MCP tool surface. Run with only nibrun connected and no GitHub authorization. Expect an explanation of the limitation and an offer of a source archive if the source is available in the chat, or a separately authorized GitHub workflow. The agent must not use deployment as a substitute or claim that code was pushed.',
      prompt: 'Push this app’s source into my private GitHub repository.',
    },
  ],
};
