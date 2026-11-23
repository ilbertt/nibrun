import { readFile } from 'node:fs/promises';
import type { Font } from 'satori';

export const SANS = 'Space Grotesk';
export const MONO = 'Space Mono';

// Static TrueType faces bypass Satori's WOFF decoder, which expects fflate's pre-0.8 API.
const FONT_FILES = [
  {
    name: SANS,
    weight: 400,
    file: '@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf',
  },
  {
    name: SANS,
    weight: 600,
    file: '@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf',
  },
  {
    name: MONO,
    weight: 400,
    file: '@expo-google-fonts/space-mono/400Regular/SpaceMono_400Regular.ttf',
  },
] as const;

export function loadShareCardFonts(): Promise<Font[]> {
  return Promise.all(
    FONT_FILES.map(async ({ name, weight, file }) => ({
      name,
      weight,
      data: await readFile(new URL(import.meta.resolve(file))),
    })),
  );
}
