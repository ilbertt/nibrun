import { Input } from '@repo/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { FileArchiveIcon } from 'lucide-react';
import { useState } from 'react';
import { FileDropZone } from '#components/deploy/file-drop-zone.tsx';
import { type FileSource, fetchedUrl, pickedFile, sourceFromUrl } from '#lib/file-source.ts';

export function InitialDataSourcePicker({
  value,
  invalid,
  onChange,
}: {
  value: FileSource | undefined;
  invalid: boolean;
  onChange: (source: FileSource | undefined) => void;
}) {
  const [chosen, setChosen] = useState(fetchedUrl(value) === undefined ? 'file' : 'url');

  function choose(next: string): void {
    setChosen(next);
    onChange(undefined);
  }

  return (
    <Tabs value={chosen} onValueChange={choose} className="gap-3">
      <TabsList>
        <TabsTrigger value="file">Upload an archive</TabsTrigger>
        <TabsTrigger value="url">From a url</TabsTrigger>
      </TabsList>
      <TabsContent value="file">
        <FileDropZone
          inputId="deploy-initial-data"
          file={pickedFile(value)}
          icon={FileArchiveIcon}
          invitation="Drop a .tar.gz or .zip here, or browse for it."
          clearLabel="Clear the archive"
          invalid={invalid}
          onPick={onChange}
        />
      </TabsContent>
      <TabsContent value="url">
        <Input
          value={fetchedUrl(value) ?? ''}
          onChange={(event) => onChange(sourceFromUrl(event.target.value))}
          placeholder="https://example.com/data.tar.gz"
          aria-label="Initial data archive url"
          aria-invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </TabsContent>
    </Tabs>
  );
}
