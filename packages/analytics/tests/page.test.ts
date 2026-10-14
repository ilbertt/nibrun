import { describe, expect, test } from 'bun:test';
import { analyticsPath, analyticsReferrer, analyticsSearch, analyticsSite } from '#page.ts';

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

  test('only utm-prefixed query parameters survive with repeated and empty values', () => {
    expect(
      analyticsSearch(
        '?code=SECRET&utm_source=email&utm_campaign=launch&utm_term=compiled%20binary&utm_custom=one&utm_custom=two&utm_extra=&env=SECRET&xutm_source=SECRET',
      ),
    ).toBe(
      '?utm_source=email&utm_campaign=launch&utm_term=compiled+binary&utm_custom=one&utm_custom=two&utm_extra=',
    );
    expect(analyticsSearch('?code=SECRET&env=SECRET')).toBe('');
    expect(analyticsSearch('')).toBe('');
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
