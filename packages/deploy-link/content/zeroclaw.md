ZeroClaw runs a personal AI agent that you can chat with from a browser or reach through a webhook.
Deploy the gateway first, then choose your model provider when you create an agent.

## Quick start

1. Click **Deploy on nibrun**.
2. In your nibrun app, open **Logs** and copy the one-time code printed under **PAIRING REQUIRED**.
3. Open the app URL, paste the code into the ZeroClaw dashboard, and click **Pair**.
4. In **Quickstart**, choose your provider and model, enter any credentials that provider needs, and create your first agent.

The first code expires after ten minutes. If it expires before anyone pairs, redeploy the app and use the code from the new deployment’s logs.
To add another browser, open **Pairing** in a browser that is already paired and choose **Pair New Device**.
Paste the new code into the second browser. The `zc_` token issued after pairing is a bearer credential for API requests.

## Running on nibrun

Incoming webhooks wake an idle app. Outbound polling and ZeroClaw’s own scheduled jobs pause while the app sleeps.

The configuration, workspace and device pairings persist across redeploys. The dashboard files come from the release archive imported when the app is created. When upgrading an existing app, update its dashboard files to match the new binary.
