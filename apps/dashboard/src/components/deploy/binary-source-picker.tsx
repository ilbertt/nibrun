import { Input } from '@repo/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs';
import { LinkIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import { BinaryDropZone } from '#components/deploy/binary-drop-zone.tsx';
import { type BinarySource, fetchedUrl, pickedFile, sourceFromUrl } from '#lib/binary-source.ts';

export const BINARY_URL_INPUT_ID = 'deploy-binary-url';

const CARD =
  'h-auto flex-col items-start gap-1 rounded-2xl border border-muted-foreground/30! bg-input/30 px-3 py-3 text-left font-normal whitespace-normal data-active:border-ring! data-active:bg-input dark:data-active:border-ring!';

type Chosen = 'file' | 'url';

/**
 * Where the binary comes from, chosen before it is given: the two cards are the question, and what
 * answers it is the one control below them.
 *
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
  value: BinarySource | undefined;
  invalid: boolean;
  keeping: boolean;
  onChange: (source: BinarySource | undefined) => void;
}) {
  const [chosen, setChosen] = useState<Chosen>(fetchedUrl(value) === undefined ? 'file' : 'url');

  // A deploy has one binary, so leaving a card gives up whatever it held. The card being looked at
  // is the one that says what will be deployed.
  function choose(next: string): void {
    const chosenNext = next as Chosen;
    setChosen(chosenNext);
    if (heldBy({ chosen: chosenNext, value }) === undefined) {
      onChange(undefined);
    }
  }

  return (
    <Tabs value={chosen} onValueChange={choose} className="gap-3">
      {/* The list is a pill of segments by default, and these are cards: its own height comes from
          a variant-prefixed class, so undoing it takes the same variant. */}
      <TabsList className="grid w-full grid-cols-2 gap-2 bg-transparent p-0 group-data-horizontal/tabs:h-auto">
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
      </TabsList>

      <TabsContent value="file">
        <BinaryDropZone
          binary={pickedFile(value)}
          invalid={invalid}
          keeping={keeping}
          onPick={onChange}
        />
      </TabsContent>

      <TabsContent value="url">
        <Input
          id={BINARY_URL_INPUT_ID}
          value={fetchedUrl(value) ?? ''}
          onChange={(event) => onChange(sourceFromUrl(event.target.value))}
          placeholder="https://github.com/me/app/releases/download/v1/my-server"
          aria-invalid={invalid}
          aria-label="Binary url"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
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
  value: BinarySource | undefined;
}): BinarySource | undefined {
  return chosen === 'file' ? pickedFile(value) : sourceFromUrl(fetchedUrl(value) ?? '');
}
