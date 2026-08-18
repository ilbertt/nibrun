import {
  awaitDeploymentSettled,
  type Deployed,
  type DeployStep,
  deploy,
  type UploadableBinary,
  type UploadProgress,
} from '@repo/app-operations';
import type { TenantArguments, TenantEnvironment } from '@repo/protocol';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { browserUpload } from '#lib/browser-upload.ts';

export type DeployRequest = {
  binary: UploadableBinary;
  args: TenantArguments;
  environment?: TenantEnvironment | undefined;
  app: string | undefined;
  name: string | undefined;
  port: number;
};

export type DeployMutation = UseMutationResult<Deployed, Error, DeployRequest>;

export function useDeploy({
  onStep,
  onProgress,
}: {
  onStep: (step: DeployStep) => void;
  onProgress: (progress: UploadProgress) => void;
}): DeployMutation {
  const queryClient = useQueryClient();

  return useMutation<Deployed, Error, DeployRequest>({
    mutationFn: async (request) => {
      const deployed = await deploy({
        api,
        ...request,
        onStep,
        upload: browserUpload,
        whileUploading: ({ task }) => task(onProgress),
      });
      const state = await awaitDeploymentSettled({
        api,
        appId: deployed.appId,
        deploymentId: deployed.deploymentId,
      });
      if (state !== 'active') {
        throw new Error(`Deployment ${deployed.deploymentId} is ${state}.`);
      }
      return deployed;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      await queryClient.invalidateQueries({ queryKey: ['deployments'] });
    },
  });
}
