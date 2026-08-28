import {
  awaitDeploymentSettled,
  type Deployed,
  type DeployStep,
  deploy,
  describeUnservedDeployment,
  redeploy,
  type UploadableBinary,
  type UploadProgress,
} from '@repo/app-operations';
import type { TenantArguments, TenantEnvironmentPatch } from '@repo/protocol';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { browserUpload } from '#lib/browser-upload.ts';

type Configured = {
  args: TenantArguments;
  environment?: TenantEnvironmentPatch | undefined;
  port: number;
};

export type DeployRequest = Configured & {
  binary: UploadableBinary;
  app: string | undefined;
  name: string | undefined;
};

/** The same release without a binary to upload, which only an app already running one can ask for. */
export type RedeployRequest = Configured & { app: string };

export type ReleaseRequest = DeployRequest | RedeployRequest;

export function carriesBinary(request: ReleaseRequest): request is DeployRequest {
  return 'binary' in request;
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

  return useMutation<Deployed, Error, ReleaseRequest>({
    mutationFn: async (request) => {
      const deployed = carriesBinary(request)
        ? await deploy({
            api,
            ...request,
            onStep,
            upload: browserUpload,
            whileUploading: ({ task }) => task(onProgress),
          })
        : await redeploy({ api, ...request, onStep });
      const settled = await awaitDeploymentSettled({
        api,
        appId: deployed.appId,
        deploymentId: deployed.deploymentId,
      });
      if (settled.state !== 'running') {
        throw new Error(describeUnservedDeployment(settled));
      }
      return deployed;
    },
    onSuccess: onDeployed,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      await queryClient.invalidateQueries({ queryKey: ['deployments'] });
    },
  });
}
