import type { GitHubWorkflow } from '@repo/app-operations';
import { runCommand, shellWord } from '#lib/run-command.ts';

export function githubWorkflowExample({
  appId,
  workflow,
  binaryName,
}: {
  appId: string;
  workflow: GitHubWorkflow;
  binaryName: string;
}): string {
  const environment =
    workflow.environment === null
      ? ''
      : `    environment: ${JSON.stringify(workflow.environment)}\n`;
  const binaryCommand = runCommand({ binaryName, args: [] });
  const command = `nib run ${shellWord(binaryCommand)} --github-trusted-oidc --app-id ${shellWord(appId)}`;
  return `name: Deploy to nibrun
on:
  push:
    branches: [${JSON.stringify(workflow.branch)}]
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
${environment}    steps:
      - uses: actions/checkout@v7
      - uses: nibrunhq/setup-cli@v1
      - name: Build binary
        run: ./build.sh
      - name: Deploy
        run: ${JSON.stringify(command)}
`;
}
