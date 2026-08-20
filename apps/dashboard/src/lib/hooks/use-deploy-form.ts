import {
  InvalidEnvironmentError,
  parseEnvironmentPatch,
  type UploadableBinary,
} from '@repo/app-operations';
import { DEFAULT_GUEST_PORT, FilenameSchema, Value } from '@repo/protocol';
import { type ReactFormExtendedApi, useForm } from '@tanstack/react-form';
import {
  type EnvironmentVariable,
  environmentEdits,
  filledVariables,
  repeatedName,
  storedNames,
} from '#lib/environment-variables.ts';
import { useApps } from '#lib/hooks/use-apps.ts';
import type { DeployRequest } from '#lib/hooks/use-deploy.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { AppSummary } from '#queries/apps.ts';

export type DeployFormValues = {
  binary: File | undefined;
  name: string;
  port: string | undefined;
  args: string | undefined;
  environment: EnvironmentVariable[] | undefined;
};

export type DeployFormApi = ReactFormExtendedApi<
  DeployFormValues,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined
>;

export type DeployFormState = {
  api: DeployFormApi;
  locked: boolean;
  replacing: AppSummary | undefined;
  targetResolved: boolean;
  defaultPort: string;
  defaultArgs: string;
};

const UNTOUCHED: DeployFormValues = {
  binary: undefined,
  name: '',
  port: undefined,
  args: undefined,
  environment: undefined,
};

export function validateBinary({ value }: { value: File | undefined }): string | undefined {
  if (value === undefined) {
    return 'Pick the binary to deploy.';
  }
  return Value.Check(FilenameSchema, value.name)
    ? undefined
    : 'That file cannot be named inside an export. Rename it and pick it again.';
}

export function validatePort({ value }: { value: string | undefined }): string | undefined {
  return value === undefined || Number.isInteger(Number(value))
    ? undefined
    : 'Ports are whole numbers.';
}

export function validateEnvironment({
  value,
}: {
  value: EnvironmentVariable[] | undefined;
}): string | undefined {
  const variables = filledVariables(value ?? []);
  if (variables.some((variable) => variable.name.trim().length === 0)) {
    return 'A variable needs a name.';
  }

  // Two rows under one name are one variable by the time they are a record, so the row that lost
  // would go without a word — and which of them lost is not something a form should decide.
  const repeated = repeatedName(variables);
  if (repeated !== undefined) {
    return `Two rows name ${repeated}; one of them has to go.`;
  }

  try {
    parseEnvironmentPatch(environmentEdits({ variables, stored: [] }));
    return undefined;
  } catch (failure) {
    return failure instanceof InvalidEnvironmentError ? failure.message : undefined;
  }
}

export function useDeployForm({ appId }: { appId: string | undefined }): DeployFormState {
  const { start } = useDeployRun();
  const apps = useApps();
  const owned = apps.data ?? [];
  const locked = appId !== undefined;
  const replacing = owned.find((app) => app.id === appId);
  const targetResolved = !locked || replacing !== undefined;

  const api: DeployFormApi = useForm({
    defaultValues: UNTOUCHED,
    onSubmit: ({ value }) => {
      const request = targetResolved ? asDeployRequest({ value, replacing }) : undefined;
      if (request !== undefined) {
        start(request);
      }
    },
  });

  return {
    api,
    locked,
    replacing,
    targetResolved,
    defaultPort: String(replacing?.config.guestPort ?? DEFAULT_GUEST_PORT),
    defaultArgs: replacing?.config.args.join('\n') ?? '',
  };
}

function asDeployRequest({
  value,
  replacing,
}: {
  value: DeployFormValues;
  replacing: AppSummary | undefined;
}): DeployRequest | undefined {
  const binary = value.binary === undefined ? undefined : uploadableFrom(value.binary);
  const port = Number(value.port ?? replacing?.config.guestPort ?? DEFAULT_GUEST_PORT);
  if (binary === undefined || !Number.isInteger(port)) {
    return undefined;
  }

  const edits = environmentEdits({
    variables: value.environment,
    stored: storedNames(replacing),
  });

  return {
    binary,
    args: tenantArguments(value.args ?? replacing?.config.args.join('\n') ?? ''),
    // Only what the table changed. A row still sealed holds a value this end has never read, so
    // it is sent as nothing at all — which is what leaves it alone — and a name the app has that
    // the table no longer does goes as null, the only way to say a variable should be removed.
    ...(edits.length === 0 ? {} : { environment: parseEnvironmentPatch(edits) }),
    app: replacing?.slug,
    name: replacing === undefined ? value.name.trim() || undefined : undefined,
    port,
  };
}

function uploadableFrom(file: File): UploadableBinary | undefined {
  return Value.Check(FilenameSchema, file.name) ? { name: file.name, body: file } : undefined;
}

function tenantArguments(onePerLine: string): string[] {
  return onePerLine
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
