import { Input } from '@repo/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { cn } from '@repo/ui/lib/utils';
import { ContainerIcon, LinkIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import { BinaryDropZone } from '#components/deploy/binary-drop-zone.tsx';
import { ImageSourceFields } from '#components/deploy/image-source-fields.tsx';
import { type AppSource, emptyImageSource, isImageSource } from '#lib/app-source.ts';
import { fetchedUrl, pickedFile, sourceFromUrl } from '#lib/file-source.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export const BINARY_URL_INPUT_ID = 'deploy-binary-url';

const CARD =
  'h-auto flex-col items-start gap-1 rounded-2xl border border-muted-foreground/30! bg-input/30 px-3 py-3 text-left font-normal whitespace-normal data-active:border-ring! data-active:bg-input dark:data-active:border-ring!';

type Chosen = 'file' | 'url' | 'image';

/**
 * The control is not in the card because half a row is not where a url is read or a file is
 * dropped — and a picker where one side is the control and the other opens one reads as two
 * different kinds of thing.
 */
export function BinarySourcePicker({
  value,
  invalid,
  keeping,
  onChange,
}: {
  value: AppSource | undefined;
  invalid: boolean;
  keeping: boolean;
  onChange: (source: AppSource | undefined) => void;
}) {
  const fileValue = isImageSource(value) ? undefined : value;
  const canUseImages = useSessionIdentity() === SessionIdentity.WithAccount;
  const [chosen, setChosen] = useState<Chosen>(initialSource(value));

  function choose(next: string): void {
    const chosenNext = next as Chosen;
    setChosen(chosenNext);
    if (heldBy({ chosen: chosenNext, value }) === undefined) {
      onChange(chosenNext === 'image' ? emptyImageSource() : undefined);
    }
  }

  return (
    <Tabs value={chosen} onValueChange={choose} className="gap-3">
      {/* The list is a pill of segments by default, and these are cards: its own height comes from
          a variant-prefixed class, so undoing it takes the same variant. */}
      <TabsList
        className={cn(
          'grid w-full gap-2 bg-transparent p-0 group-data-horizontal/tabs:h-auto',
          canUseImages ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        <TabsTrigger value="file" className={CARD}>
          <span className="flex items-center gap-2 font-medium">
            <UploadIcon />
            Upload a file
          </span>
          <span className="text-muted-foreground text-xs">From this machine.</span>
        </TabsTrigger>
        <TabsTrigger value="url" className={CARD}>
          <span className="flex items-center gap-2 font-medium">
            <LinkIcon />
            From a url
          </span>
          <span className="text-muted-foreground text-xs">nibrun fetches it.</span>
        </TabsTrigger>
        {canUseImages && (
          <TabsTrigger value="image" className={CARD}>
            <span className="flex items-center gap-2 font-medium">
              <ContainerIcon />
              Container image
            </span>
            <span className="text-muted-foreground text-xs">From a public registry.</span>
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="file">
        <BinaryDropZone
          binary={pickedFile(fileValue)}
          invalid={invalid}
          keeping={keeping}
          onPick={onChange}
        />
      </TabsContent>

      <TabsContent value="url">
        <Input
          id={BINARY_URL_INPUT_ID}
          value={fetchedUrl(fileValue) ?? ''}
          onChange={(event) => onChange(sourceFromUrl(event.target.value))}
          placeholder="https://github.com/me/app/releases/download/v1/my-server"
          aria-invalid={invalid}
          aria-label="Binary url"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </TabsContent>
      <TabsContent value="image">
        <ImageSourceFields
          value={isImageSource(value) ? value : emptyImageSource()}
          invalid={invalid}
          onChange={onChange}
        />
      </TabsContent>
    </Tabs>
  );
}

function heldBy({
  chosen,
  value,
}: {
  chosen: Chosen;
  value: AppSource | undefined;
}): AppSource | undefined {
  if (chosen === 'image') {
    return isImageSource(value) ? value : undefined;
  }
  const fileValue = isImageSource(value) ? undefined : value;
  return chosen === 'file' ? pickedFile(fileValue) : sourceFromUrl(fetchedUrl(fileValue) ?? '');
}

function initialSource(value: AppSource | undefined): Chosen {
  if (isImageSource(value)) {
    return 'image';
  }
  return fetchedUrl(value) === undefined ? 'file' : 'url';
}
