import { expect, test } from 'bun:test';
import { websiteIcon } from '#lib/oauth-client-icon.ts';

const PAGE_URL = new URL('https://client.example/account/login');

test('uses the declared icon instead of guessing a root favicon', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: '<head><link href="../assets/brand.svg?v=1&amp;theme=dark" rel="shortcut ICON"></head>',
    }),
  ).toBe('https://client.example/assets/brand.svg?v=1&theme=dark');
});

test('resolves icons against the first base declaration', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: '<head><base href="https://cdn.example/app/"><base href="https://other.example/"><link rel="icon" href="brand.png"></head>',
    }),
  ).toBe('https://cdn.example/app/brand.png');
});

test('prefers a standard icon to a touch icon', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: '<head><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="//cdn.example/icon.svg"></head>',
    }),
  ).toBe('https://cdn.example/icon.svg');
});

test('uses a declared touch icon when no standard icon is present', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: '<head><link rel="apple-touch-icon" href="/touch.png"></head>',
    }),
  ).toBe('https://client.example/touch.png');
});

test('ignores scripts, body links, non-icons, and unsafe icon URLs', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: `<head>
        <script>'<link rel="icon" href="https://fake.example/logo.png">'</script>
        <link rel="stylesheet" href="/styles.css">
        <link rel="icon" href="">
        <link rel="icon" href="javascript:alert(1)">
        <link rel="icon" href="jav&#x61;script&colon;alert(1)">
        <link rel="icon" href="data:image/svg+xml,icon">
        <link rel="icon" href="https://user:password@other.example/icon.png">
        <link rel="icon" href="http://other.example/icon.png">
      </head><body><link rel="icon" href="/body.png"></body>`,
    }),
  ).toBeNull();
});

test('ignores an unsafe base and continues to a usable icon', () => {
  expect(
    websiteIcon({
      url: PAGE_URL,
      html: '<head><base href="javascript:alert(1)"><link rel="icon" href="data:image/png,x"><link rel="icon" href="/real.svg"></head>',
    }),
  ).toBe('https://client.example/real.svg');
});
