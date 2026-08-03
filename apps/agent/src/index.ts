import { Agent } from '#agent.ts';
import { describeError, logger } from '#lib/logger.ts';

const FAILURE_EXIT_CODE = 1;

const agent = await Agent.create();

// The agent stopping must not stop anything it started. The VMs are systemd's children, so
// exiting here leaves every tenant app running — which is the property that lets this
// component be redeployed as often as it changes.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ message: 'shutting down', signal });
    agent.stop();
  });
}

try {
  await agent.run();
} catch (error) {
  logger.error({ message: 'agent exited', ...describeError(error) });
  process.exit(FAILURE_EXIT_CODE);
}
