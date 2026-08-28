import { Input } from '@repo/ui/components/input';
import { LinkIcon } from 'lucide-react';
import { namedByUrl } from '#lib/binary-source.ts';

export const BINARY_URL_INPUT_ID = 'deploy-binary-url';

export function BinaryUrlBox({
  url,
  invalid,
  onType,
}: {
  url: string;
  invalid: boolean;
  onType: (url: string) => void;
}) {
  // Only for a url that would be followed: saying what a refused one fetches is promising
  // something this box is at the same time refusing to do.
  const named = invalid ? undefined : namedByUrl(url);

  return (
    <div
      data-invalid={invalid || undefined}
      className="flex w-full flex-col gap-2 rounded-2xl border border-muted-foreground/30 border-dashed bg-input/50 px-3 py-4 text-sm transition-[color,background-color,box-shadow] duration-200 hover:bg-input has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/30 data-[invalid=true]:border-destructive/50"
    >
      <label
        htmlFor={BINARY_URL_INPUT_ID}
        className="flex min-w-0 items-center gap-3 font-normal text-muted-foreground"
      >
        <LinkIcon className="size-4 shrink-0" />
        <span>Or fetch it from a url.</span>
      </label>
      <Input
        id={BINARY_URL_INPUT_ID}
        value={url}
        onChange={(event) => onType(event.target.value)}
        placeholder="https://github.com/me/app/releases/download/v1/my-server"
        aria-invalid={invalid}
        aria-label="Binary url"
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
      {/* The name the url is read as, so what an export will carry is seen before it is deployed
          rather than found afterwards. */}
      <span className="truncate text-muted-foreground text-xs">
        {named === undefined ? 'nibrun fetches it for you.' : `nibrun fetches ${named}.`}
      </span>
    </div>
  );
}
