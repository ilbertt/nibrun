import { expect, test } from 'bun:test';
import { createElement } from '@tanstack/redact';
import { renderToReadableStream, renderToStaticMarkup } from '@tanstack/redact/server';

test('SVG gradient colors and opacity survive static and streaming server rendering', async () => {
  const gradient = createElement(
    'svg',
    null,
    createElement(
      'linearGradient',
      { id: 'gradient' },
      createElement('stop', { offset: '0%', stopColor: '#16a34a', stopOpacity: 0.5 }),
    ),
  );
  const stream = await renderToReadableStream(gradient);
  const streamedMarkup = await new Response(stream).text();

  for (const markup of [renderToStaticMarkup(gradient), streamedMarkup]) {
    expect(markup).toContain('stop-color="#16a34a"');
    expect(markup).toContain('stop-opacity="0.5"');
  }
});
