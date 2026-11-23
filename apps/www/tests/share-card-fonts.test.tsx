import { expect, test } from 'bun:test';
import satori, { type Font } from 'satori';
import { loadShareCardFonts } from '../scripts/share-card-fonts.ts';

async function glyphOutline({ font, letter }: { font: Font; letter: string }) {
  const svg = await satori(
    <div style={{ fontFamily: font.name, fontWeight: font.weight }}>{letter}</div>,
    { width: 100, height: 100, fonts: [font] },
  );
  return svg.match(/<path\b[^>]*\sd="([^"]+)"/)?.[1];
}

for (const font of await loadShareCardFonts()) {
  test(`${font.name} ${font.weight} renders distinct letter outlines on share cards`, async () => {
    const [i, w] = await Promise.all(['I', 'W'].map((letter) => glyphOutline({ font, letter })));
    expect(i).toBeDefined();
    expect(w).toBeDefined();
    expect(i).not.toBe(w);
  });
}
