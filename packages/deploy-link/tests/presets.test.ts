import { expect, test } from 'bun:test';
import { defaultStringifySearch } from '@tanstack/react-router';
import { DEPLOY_PRESETS, type DeploySlug } from '#presets.ts';

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
    expect(written).toContain('binary');
  }
});
