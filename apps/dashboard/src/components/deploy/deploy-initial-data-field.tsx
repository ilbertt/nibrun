import { MAX_IMPORT_SIZE_BYTES } from '@repo/app-operations';
import { Field, FieldDescription, FieldError } from '@repo/ui/components/field';
import { FileArchiveIcon } from 'lucide-react';
import { FileDropZone } from '#components/deploy/file-drop-zone.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { type DeployFormApi, validateInitialData } from '#lib/hooks/use-deploy-form.ts';

const INITIAL_DATA_INPUT_ID = 'deploy-initial-data';

/**
 * The archive the app's volume is created holding, refused here before it is sent: the api reads
 * the object rather than the request, so anything but a `.tar.gz` is a gibibyte spent to be told no.
 */
export function DeployInitialDataField({ api }: { api: DeployFormApi }) {
  return (
    <api.Field name="initialData" validators={{ onChangeAsync: validateInitialData }}>
      {(field) => {
        const [issue] = field.state.meta.errors;
        return (
          <Field data-invalid={issue !== undefined || undefined}>
            <FileDropZone
              inputId={INITIAL_DATA_INPUT_ID}
              file={field.state.value}
              icon={FileArchiveIcon}
              invitation="Drop a .tar.gz here, or browse for it."
              clearLabel="Clear the archive"
              invalid={issue !== undefined}
              onPick={field.handleChange}
            />
            <FieldDescription>
              Unpacked into <code className="font-mono">data/</code> before the app starts. One{' '}
              <code className="font-mono">.tar.gz</code>, up to {formatBytes(MAX_IMPORT_SIZE_BYTES)}
              .
            </FieldDescription>
            {issue !== undefined && <FieldError>{issue}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}
