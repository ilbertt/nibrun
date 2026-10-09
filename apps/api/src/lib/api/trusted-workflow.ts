import { type Static, Type } from '@sinclair/typebox';
import { TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';

const REPOSITORY_PATTERN =
  '^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?/[a-zA-Z0-9_-][a-zA-Z0-9._-]*$';
const WORKFLOW_PATTERN = '^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\\.ya?ml$';
const BRANCH_PATTERN =
  '^(?!/)(?!.*(?:\\.\\.|@\\{|//|\\.lock(?:/|$)))(?!@?$)(?!.*(?:^|/)\\.)(?!.*[/.]$)[^\\x00-\\x20\\x7f~^:?*\\[\\\\]+$';
const REPOSITORY_MAX_LENGTH = 140;
const WORKFLOW_MAX_LENGTH = 255;
const BRANCH_MAX_LENGTH = 255;
const ENVIRONMENT_MAX_LENGTH = 255;

export const TrustedWorkflowSchema = Type.Object(
  {
    repository: Type.String({ pattern: REPOSITORY_PATTERN, maxLength: REPOSITORY_MAX_LENGTH }),
    workflow: Type.String({ pattern: WORKFLOW_PATTERN, maxLength: WORKFLOW_MAX_LENGTH }),
    branch: Type.String({ pattern: BRANCH_PATTERN, maxLength: BRANCH_MAX_LENGTH }),
    environment: Type.Union([
      Type.String({ minLength: 1, maxLength: ENVIRONMENT_MAX_LENGTH, pattern: '\\S' }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export type TrustedWorkflow = Static<typeof TrustedWorkflowSchema>;

export const TrustedWorkflowResourceSchema = Type.Object(
  { id: TrustedWorkflowIdSchema, ...TrustedWorkflowSchema.properties },
  { additionalProperties: false },
);

export type TrustedWorkflowResource = Static<typeof TrustedWorkflowResourceSchema>;
