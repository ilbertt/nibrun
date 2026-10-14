import { ApiError, unwrap } from '@repo/api-client/unwrap';

export class DeploymentError extends ApiError {}

type ApiReply = { data: unknown; error: unknown };

export async function deploymentApiRequest<R extends ApiReply>({
  response,
  operation,
  rejectionHint,
}: {
  response: Promise<R>;
  operation: string;
  rejectionHint: string | undefined;
}): Promise<NonNullable<R['data']>> {
  let reply: R;
  try {
    reply = await response;
  } catch {
    throw connectionFailure(operation);
  }
  if (reply.error === null) {
    return unwrap(reply);
  }
  const failure = reply.error;
  if (
    typeof failure === 'object' &&
    failure !== null &&
    'value' in failure &&
    failure.value instanceof Error
  ) {
    throw connectionFailure(operation);
  }
  const status =
    typeof failure === 'object' &&
    failure !== null &&
    'status' in failure &&
    typeof failure.status === 'number' &&
    Number.isInteger(failure.status)
      ? ` (HTTP ${failure.status})`
      : '';
  throw new DeploymentError(
    `Could not ${operation}: nibrun rejected the request${status}.${rejectionHint ? ` ${rejectionHint}` : ''}`,
  );
}

function connectionFailure(operation: string): DeploymentError {
  return new DeploymentError(
    `Could not ${operation}: the nibrun API could not be reached. Check network connectivity and NIBRUN_API_URL, then retry.`,
  );
}
