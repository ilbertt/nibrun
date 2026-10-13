import { MAX_IMPORT_SIZE_BYTES } from '@repo/app-operations';
import { Field, FieldDescription, FieldError } from '@repo/ui/components/field';
import { InitialDataSourcePicker } from '#components/deploy/initial-data-source-picker.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { type DeployFormApi, validateInitialData } from '#lib/hooks/use-deploy-form.ts';

/**
 * The archive the app's volume is created holding, refused here before it is sent: the api reads
 * the object rather than the request, so anything but one of the two is a gibibyte spent to be
 * told no.
 */
export function DeployInitialDataField({ api }: { api: DeployFormApi }) {
  return (
    <api.Field name="initialData" validators={{ onChangeAsync: validateInitialData }}>
      {(field) => {
        const [issue] = field.state.meta.errors;
        return (
          <Field data-invalid={issue !== undefined || undefined}>
            <InitialDataSourcePicker
              value={field.state.value}
              invalid={issue !== undefined}
              onChange={field.handleChange}
            />
            <FieldDescription>
              Unpacked into <code className="font-mono">data/</code> before the app starts. One{' '}
              <code className="font-mono">.tar.gz</code> or <code className="font-mono">.zip</code>,
              up to {formatBytes(MAX_IMPORT_SIZE_BYTES)}. URLs are fetched by nibrun over HTTPS.
            </FieldDescription>
            {issue !== undefined && <FieldError>{issue}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}
