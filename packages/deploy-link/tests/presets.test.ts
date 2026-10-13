import { expect, test } from 'bun:test';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { deployLink, deploySuggestion } from '#link.ts';
import { DEPLOY_PRESETS, DeployCategory, type DeployPreset, type DeploySlug } from '#presets.ts';

const SLUGS = Object.keys(DEPLOY_PRESETS) as DeploySlug[];

test('every preset is named and says what it is', () => {
  for (const slug of SLUGS) {
    expect(DEPLOY_PRESETS[slug].title).not.toBe('');
    expect(DEPLOY_PRESETS[slug].subtitle).not.toBe('');
  }
});

// Why the link is a field rather than the rest of the preset: whatever is handed to the deploy
// screen is stringified whole into its URL, and a preset carries prose a link does not.
test('a deploy url carries the link and nothing written beside it', () => {
  for (const slug of SLUGS) {
    const written = defaultStringifySearch(DEPLOY_PRESETS[slug].deployLink);

    expect(written).not.toContain('subtitle');
    expect(written).not.toContain('category');
    expect(written).toContain('binary');
  }
});

test('a preset can suggest initial data through a rewritten deployment link', () => {
  const archiveUrl = 'https://releases.test/seed.tar.gz?signature=a%2Fb&expires=123';
  const preset: DeployPreset = {
    ...DEPLOY_PRESETS.pocketbase,
    deployLink: { ...DEPLOY_PRESETS.pocketbase.deployLink, 'initial-data': archiveUrl },
  };
  const written = defaultStringifySearch(preset.deployLink);
  const parsed = deployLink(defaultParseSearch(written));
  const configured = defaultStringifySearch({ ...parsed, minimal: undefined });

  expect(deploySuggestion(parsed).initialData).toBe(archiveUrl);
  expect(deploySuggestion(deployLink(defaultParseSearch(configured))).initialData).toBe(archiveUrl);
});

// A member nothing is in is one a catalog would render as a filter that returns an empty page.
test('every category has something in it', () => {
  for (const category of Object.values(DeployCategory)) {
    expect(SLUGS.some((slug) => DEPLOY_PRESETS[slug].category === category)).toBe(true);
  }
});
