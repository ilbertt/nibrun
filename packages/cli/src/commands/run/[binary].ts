import { defineCommand } from '@parshjs/core';
import { z } from 'zod';

export const command = defineCommand('run [binary]', {
  description: 'Deploy a compiled binary and run it. Arguments after `--` are passed to it.',
  params: {
    binary: { schema: z.string().min(1) },
  },
  options: {
    app: {
      schema: z.string().optional(),
      description: 'Slug of an existing app to deploy onto. A new app is created when omitted.',
    },
    name: {
      schema: z.string().optional(),
      description: 'Name for the new app. Defaults to the binary filename.',
    },
    port: {
      schema: z.number().int().optional(),
      description: 'Port the binary listens on inside the guest.',
    },
    vcpu: { schema: z.number().int().optional(), description: 'vCPUs the guest is given.' },
    memory: {
      schema: z.number().int().optional(),
      description: 'Memory the guest is given, in MiB.',
    },
    detach: {
      schema: z.boolean().optional(),
      aliases: ['d'],
      description: 'Return once the deployment is created instead of waiting for it to serve.',
    },
  },
  handler: async ({ params, options, context, print }) => {
    const { createApi } = await import('#lib/api.ts');
    const { deploy } = await import('#lib/deploy.ts');

    await deploy({
      ...options,
      api: createApi({ baseUrl: context.env.NIB_API_URL, apiKey: context.env.NIB_API_KEY }),
      print,
      binaryPath: params.binary,
      args: context.tenantArgs,
    });
  },
});
