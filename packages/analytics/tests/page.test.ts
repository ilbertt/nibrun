import { describe, expect, test } from 'bun:test';
import { analyticsPath, analyticsReferrer, analyticsSite } from '#page.ts';

describe('analytics URLs', () => {
  test('only the two production sites are tracked', () => {
    expect(analyticsSite('nibrun.com')).toBe('www');
    expect(analyticsSite('app.nibrun.com')).toBe('dashboard');
    expect(analyticsSite('localhost')).toBeUndefined();
    expect(analyticsSite('preview.nibrun.com')).toBeUndefined();
    expect(analyticsSite('tenant.nibrun.app')).toBeUndefined();
  });

  test('site prefixes distinguish the two homepages', () => {
    expect(analyticsPath({ site: 'www', pathname: '/' })).toBe('/www/');
    expect(analyticsPath({ site: 'dashboard', pathname: '/' })).toBe('/dashboard/');
  });

  test('app identifiers and file paths stay out of referrers', () => {
    expect(
      analyticsReferrer('https://app.nibrun.com/apps/private-app/files?path=/passwords#key'),
    ).toBe('https://app.nibrun.com/dashboard/apps/:appId/files');
  });

  test('deployment environment and authentication parameters are discarded', () => {
    expect(
      analyticsReferrer('https://app.nibrun.com/deploy?env=TOKEN%3Dsecret&binary=private#key'),
    ).toBe('https://app.nibrun.com/dashboard/deploy');
    expect(analyticsReferrer('https://github.com/login/oauth?code=secret')).toBe(
      'https://github.com',
    );
    expect(analyticsReferrer('invalid')).toBe('');
  });
});
