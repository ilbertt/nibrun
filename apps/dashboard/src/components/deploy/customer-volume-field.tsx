import { Field, FieldDescription, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import type { DeployFormApi } from '#lib/hooks/use-deploy-form.ts';

export function CustomerVolumeField({ api }: { api: DeployFormApi }) {
  return (
    <api.Field name="volumeStorageFile">
      {(field) => (
        <Field>
          <FieldLabel htmlFor="deploy-storage-file">Bucket configuration</FieldLabel>
          <Input
            id="deploy-storage-file"
            type="file"
            accept=".json,application/json"
            onChange={(event) => field.handleChange(event.currentTarget.files?.[0])}
          />
          <FieldDescription>
            Leave empty for nibrun storage. To use your own S3-compatible bucket, choose a private
            JSON file.{' '}
            <a href="/customer-volume.example.json" download className="underline">
              Download example
            </a>
          </FieldDescription>
        </Field>
      )}
    </api.Field>
  );
}
