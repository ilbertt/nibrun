import { analyticsIdentityState, trackEvent } from '@repo/analytics';
import type { TenantEnvironmentPatch } from '@repo/api/schemas/environment';
import {
  awaitDeploymentSettled,
  type DeployableBinary,
  type Deployed,
  type DeployStep,
  deploy,
  describeUnservedDeployment,
  redeploy,
  type UploadableArchive,
  type UploadProgress,
} from '@repo/app-operations';
import type { TenantArguments } from '@repo/protocol/schemas/app';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { browserUpload } from '#lib/browser-upload.ts';
import { DeploymentAnalytics, presetForBinary } from '#lib/deployment-analytics.ts';
import { useAnonymousSignIn } from '#lib/hooks/use-anonymous-sign-in.ts';
import { useSession } from '#lib/hooks/use-session.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

type Configured = {
  args: TenantArguments;
  environment?: TenantEnvironmentPatch | undefined;
  port: number;
};

export type DeployRequest = Configured & {
  binary: DeployableBinary;
  appId: string | undefined;
  name: string | undefined;
  initialData: UploadableArchive | undefined;
};

/** The same release without a binary to upload, which only an app already running one can ask for. */
export type RedeployRequest = Configured & { appId: string };

export type ReleaseRequest = DeployRequest | RedeployRequest;

export function carriesBinary(request: ReleaseRequest): request is DeployRequest {
  return 'binary' in request;
}

/** Whether an archive follows the binary, which is a second upload and leaves no step of its own. */
export function carriesInitialData(request: ReleaseRequest): boolean {
  return carriesBinary(request) && request.initialData !== undefined;
}

export type BinaryDelivery = 'upload' | 'fetch' | 'none';

/** Who moves the bytes, which decides whether there is anything to put a meter on. */
export function binaryDelivery(request: ReleaseRequest): BinaryDelivery {
  if (!carriesBinary(request)) {
    return 'none';
  }
  return 'body' in request.binary ? 'upload' : 'fetch';
}

export type DeployMutation = UseMutationResult<Deployed, Error, ReleaseRequest>;

export function useDeploy({
  onStep,
  onProgress,
  onDeployed,
}: {
  onStep: (step: DeployStep) => void;
  onProgress: (progress: UploadProgress) => void;
  onDeployed: ((deployed: Deployed) => void) | undefined;
}): DeployMutation {
  const queryClient = useQueryClient();
  const session = useSession();
  const signInAnonymously = useAnonymousSignIn();
  const identity = useSessionIdentity();

  return useMutation<Deployed, Error, ReleaseRequest>({
    mutationFn: async (request) => {
      const analytics = deploymentAnalytics({ request, identity });
      function reportStep(step: DeployStep): void {
        analytics.step(step);
        onStep(step);
      }
      try {
        // A deploy is the one thing a visitor with no session may ask for, and asking is what makes
        // them a stranger: nothing is minted for a visit that never presses the button.
        if (session === null) {
          analytics.authenticating();
          await signInAnonymously();
          analytics.authenticated(SessionIdentity.Anonymous);
        }
        const deployed = carriesBinary(request)
          ? await deploy({
              api,
              ...request,
              onStep: reportStep,
              upload: browserUpload,
              whileUploading: ({ task }) => task(onProgress),
            })
          : await redeploy({ api, ...request, onStep: reportStep });
        const settled = await awaitDeploymentSettled({
          api,
          appId: deployed.appId,
          deploymentId: deployed.deploymentId,
        });
        if (settled.state !== 'running') {
          throw new Error(describeUnservedDeployment(settled));
        }
        analytics.succeeded(deployed);
        return deployed;
      } catch (error) {
        analytics.failed();
        throw error;
      }
    },
    onSuccess: onDeployed,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      await queryClient.invalidateQueries({ queryKey: ['deployments'] });
    },
  });
}

function deploymentAnalytics({
  request,
  identity,
}: {
  request: ReleaseRequest;
  identity: SessionIdentity;
}): DeploymentAnalytics {
  return new DeploymentAnalytics({
    emit: trackEvent,
    data: {
      identity_state:
        identity === SessionIdentity.Visitor &&
        analyticsIdentityState() === SessionIdentity.Anonymous
          ? SessionIdentity.Anonymous
          : identity,
      operation:
        request.appId === undefined ? 'create' : carriesBinary(request) ? 'update' : 'retry',
      binary_delivery: binaryDelivery(request),
      has_initial_data: carriesInitialData(request),
      preset_slug:
        carriesBinary(request) && 'url' in request.binary
          ? presetForBinary(request.binary.url)
          : undefined,
    },
  });
}
