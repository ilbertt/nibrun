import {
  type EnvironmentAssignment,
  InvalidEnvironmentError,
  parseEnvFile,
} from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { FileUpIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

/** Only where an app is being created: a file cannot say anything about a value it never saw. */
export function EnvFilePicker({ onLoad }: { onLoad: (entries: EnvironmentAssignment[]) => void }) {
  const input = useRef<HTMLInputElement>(null);

  async function load(file: File | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }

    try {
      onLoad(parseEnvFile(await file.text()));
    } catch (failure) {
      toast.error(
        failure instanceof InvalidEnvironmentError
          ? failure.message
          : `${file.name} could not be read.`,
      );
    }

    // A file input reports no change for the file it already holds, so a file that was corrected
    // and picked again would do nothing at all.
    if (input.current !== null) {
      input.current.value = '';
    }
  }

  return (
    <>
      {/* Named by the button rather than by a label of its own: what the button says is what
          this does, and two names for one control is one name too many. */}
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void load(event.target.files?.[0]);
        }}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()}>
        <FileUpIcon data-icon="inline-start" />
        Load a .env file
      </Button>
    </>
  );
}
