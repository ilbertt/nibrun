import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { WWW_SITE } from '@repo/global-constants';
import { Resvg } from '@resvg/resvg-js';
import type { ReactElement } from 'react';
import satori, { type Font } from 'satori';

const require = createRequire(import.meta.url);

// Static cuts rather than the variable faces the site loads: satori reads neither a variable
// font nor woff2, which are the only two things the site's own packages ship.
const FONT_FILES = [
  {
    name: 'Space Grotesk',
    weight: 400,
    file: '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff',
  },
  {
    name: 'Space Grotesk',
    weight: 600,
    file: '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff',
  },
  {
    name: 'Space Mono',
    weight: 400,
    file: '@fontsource/space-mono/files/space-mono-latin-400-normal.woff',
  },
] as const;

let fonts: Promise<Font[]> | undefined;

function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    FONT_FILES.map(async ({ name, weight, file }) => ({
      name,
      weight,
      style: 'normal' as const,
      data: await readFile(require.resolve(file)),
    })),
  );
  return fonts;
}

export async function renderCard(card: ReactElement): Promise<Uint8Array> {
  const svg = await satori(card, {
    width: WWW_SITE.ogImage.width,
    height: WWW_SITE.ogImage.height,
    fonts: await loadFonts(),
  });
  return new Resvg(svg).render().asPng();
}
