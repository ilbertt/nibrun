import {
  type DeployableBinary,
  InvalidEnvironmentError,
  parseEnvironmentPatch,
} from '@repo/app-operations';
import { DEFAULT_HTTP_PORT, FilenameSchema, Value } from '@repo/protocol';
import { type ReactFormExtendedApi, useForm } from '@tanstack/react-form';
import {
  type BinarySource,
  fetchedUrl,
  namedByUrl,
  pickedFile,
  refusedUrl,
} from '#lib/binary-source.ts';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import {
  askedVariables,
  type EnvironmentVariable,
  environmentEdits,
  filledVariables,
  repeatedName,
  storedNames,
  unfilledAsked,
} from '#lib/environment-variables.ts';
import { useApps } from '#lib/hooks/use-apps.ts';
import type { ReleaseRequest } from '#lib/hooks/use-deploy.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { AppSummary } from '#queries/apps.ts';

export type DeployFormValues = {
  binary: BinarySource | undefined;
  name: string;
  port: string | undefined;
  extraPublicPort: boolean | undefined;
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
  defaultExtraPublicPort: boolean;
  defaultArgs: string;
};

const UNTOUCHED: DeployFormValues = {
  binary: undefined,
  name: '',
  port: undefined,
  extraPublicPort: undefined,
  args: undefined,
  environment: undefined,
};

export function validateBinary({ value }: { value: BinarySource | undefined }): string | undefined {
  if (value === undefined) {
    return 'Pick the binary to deploy, or give the url it can be fetched at.';
  }
  return validateBinarySource(value);
}

/** What an app already running one asks of the field: a binary it could keep, or nothing at all. */
export function validateKeptBinary({
  value,
}: {
  value: BinarySource | undefined;
}): string | undefined {
  return value === undefined ? undefined : validateBinarySource(value);
}

function validateBinarySource(source: BinarySource): string | undefined {
  const url = fetchedUrl(source);
  if (url !== undefined) {
    return refusedUrl(url);
  }
  const file = pickedFile(source);
  return file !== undefined && !Value.Check(FilenameSchema, file.name)
    ? 'That file cannot be named inside an export. Rename it and pick it again.'
    : undefined;
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

  // First, and not only because it is the one thing on the form that nothing else could supply —
  // not the link, not the app, not a default. It is also the one the form waits on rather than
  // refuses, and the field reads it as such by having no other issue to show while it stands.
  const unfilled = unfilledAsked(variables);
  if (unfilled.length > 0) {
    return `Fill in what the link asked for: ${unfilled.join(', ')}.`;
  }

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

export function useDeployForm({
  appId,
  binary,
  suggested,
}: {
  appId: string | undefined;
  binary: File | undefined;
  suggested?: DeploySuggestion | undefined;
}): DeployFormState {
  const { start } = useDeployRun();
  const apps = useApps();
  const owned = apps.data ?? [];
  const locked = appId !== undefined;
  const replacing = owned.find((app) => app.id === appId);
  const targetResolved = !locked || replacing !== undefined;

  const api: DeployFormApi = useForm({
    // Read once, at mount. A binary handed over from the landing page is only rendered into
    // this form after it has been read out of storage, so there is nothing to arrive later.
    defaultValues: suggestedValues({ binary, suggested }),
    onSubmit: ({ value }) => {
      const request = targetResolved ? asReleaseRequest({ value, replacing }) : undefined;
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
    defaultPort: String(replacing?.config.httpPort ?? DEFAULT_HTTP_PORT),
    defaultExtraPublicPort: replacing?.config.hasExtraPublicPort ?? false,
    defaultArgs: replacing?.config.args.join('\n') ?? '',
  };
}

/**
 * What a link asked for, as the form's own values rather than as anything shown in an empty field:
 * a release is made of what these hold, so a suggestion only displayed would be one the owner has
 * to retype for it to count.
 */
function suggestedValues({
  binary,
  suggested,
}: {
  binary: File | undefined;
  suggested: DeploySuggestion | undefined;
}): DeployFormValues {
  return {
    ...UNTOUCHED,
    // A binary handed over from the landing page is one somebody dropped, which outranks a url a
    // link they followed happened to name.
    binary: binary ?? (suggested?.binary === undefined ? undefined : { url: suggested.binary }),
    name: suggested?.name ?? namedByUrl(suggested?.binary ?? '') ?? UNTOUCHED.name,
    port: suggested?.port === undefined ? undefined : String(suggested.port),
    extraPublicPort: suggested?.extraPublicPort,
    args: suggested?.args?.join('\n'),
    environment: suggested?.environment && askedVariables(suggested.environment),
  };
}

/**
 * The form as the release it asks for. No binary is a release of the one the app already runs,
 * which only an app that is running one can mean — so a form with neither is a form that has
 * nothing to deploy, and nothing is what it submits.
 */
function asReleaseRequest({
  value,
  replacing,
}: {
  value: DeployFormValues;
  replacing: AppSummary | undefined;
}): ReleaseRequest | undefined {
  const port = Number(value.port ?? replacing?.config.httpPort ?? DEFAULT_HTTP_PORT);
  if (!Number.isInteger(port)) {
    return undefined;
  }

  const edits = environmentEdits({
    variables: value.environment,
    stored: storedNames(replacing),
  });

  const configured = {
    args: tenantArguments(value.args ?? replacing?.config.args.join('\n') ?? ''),
    // Only what the table changed. A row still sealed holds a value this end has never read, so
    // it is sent as nothing at all — which is what leaves it alone — and a name the app has that
    // the table no longer does goes as null, the only way to say a variable should be removed.
    ...(edits.length === 0 ? {} : { environment: parseEnvironmentPatch(edits) }),
    port,
    extraPublicPort: value.extraPublicPort ?? replacing?.config.hasExtraPublicPort ?? false,
  };

  if (value.binary === undefined) {
    return replacing === undefined ? undefined : { ...configured, app: replacing.slug };
  }

  const binary = deployableFrom(value.binary);
  return binary === undefined
    ? undefined
    : {
        ...configured,
        binary,
        app: replacing?.slug,
        name: replacing === undefined ? value.name.trim() || undefined : undefined,
      };
}

/**
 * The source as what the deploy sends: a file goes to the store from here, and a url goes to the
 * api, which is the end that can read it.
 */
function deployableFrom(source: BinarySource): DeployableBinary | undefined {
  const url = fetchedUrl(source);
  if (url !== undefined) {
    return refusedUrl(url) === undefined ? { url } : undefined;
  }
  const file = pickedFile(source);
  if (file === undefined) {
    return undefined;
  }
  return Value.Check(FilenameSchema, file.name) ? { name: file.name, body: file } : undefined;
}

/** The lines that are arguments: what a blank one is not, and what the trailing newline is not. */
export function tenantArguments(onePerLine: string): string[] {
  return onePerLine
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
