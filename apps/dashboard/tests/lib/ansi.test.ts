import { describe, expect, test } from 'bun:test';
import { ansiSpans } from '#lib/ansi.ts';

const ESC = '\x1b';

describe('a message the guest wrote plainly stays one run', () => {
  test('text with no escapes is a single unstyled span', () => {
    expect(ansiSpans('listening on http://0.0.0.0:3000')).toEqual([
      { offset: 0, text: 'listening on http://0.0.0.0:3000', style: {} },
    ]);
  });

  test('an empty message has nothing to show', () => {
    expect(ansiSpans('')).toEqual([]);
  });
});

describe('a colour the guest asked for is the colour it gets', () => {
  test('a coloured word is its own span and the reset ends it', () => {
    expect(ansiSpans(`${ESC}[32mINFO ${ESC}[0m [db/migrate] applied`)).toEqual([
      { offset: 5, text: 'INFO ', style: { color: 'var(--ansi-green)' } },
      { offset: 14, text: ' [db/migrate] applied', style: {} },
    ]);
  });

  test('the bright range is the bright colour, not the standard one', () => {
    expect(ansiSpans(`${ESC}[91mfailed`)[0]?.style.color).toBe('var(--ansi-bright-red)');
  });

  test('a background code paints behind rather than in front', () => {
    expect(ansiSpans(`${ESC}[44mnotice`)[0]?.style).toMatchObject({
      backgroundColor: 'var(--ansi-blue)',
    });
  });

  test('codes packed into one escape all apply', () => {
    expect(ansiSpans(`${ESC}[1;4;33mwarn`)[0]?.style).toMatchObject({
      color: 'var(--ansi-yellow)',
      fontWeight: 'bold',
      textDecoration: 'underline',
    });
  });

  test('the default-colour code drops the colour and keeps the rest', () => {
    expect(ansiSpans(`${ESC}[1;31ma${ESC}[39mb`)[1]?.style).toMatchObject({
      color: undefined,
      fontWeight: 'bold',
    });
  });

  test('a bare escape is a reset, the way a terminal reads it', () => {
    expect(ansiSpans(`${ESC}[31ma${ESC}[mb`)[1]?.style).toEqual({
      color: undefined,
      backgroundColor: undefined,
      fontWeight: undefined,
      fontStyle: undefined,
      opacity: undefined,
      textDecoration: undefined,
    });
  });
});

describe('the colour spaces beyond the sixteen names', () => {
  test('an indexed colour inside the named range is the named colour', () => {
    expect(ansiSpans(`${ESC}[38;5;2mok`)[0]?.style.color).toBe('var(--ansi-green)');
  });

  test('an indexed colour in the cube is the channel it stands for', () => {
    expect(ansiSpans(`${ESC}[38;5;196mstop`)[0]?.style.color).toBe('rgb(255 0 0)');
  });

  test('an indexed colour in the gray ramp is a gray', () => {
    expect(ansiSpans(`${ESC}[38;5;240mquiet`)[0]?.style.color).toBe('rgb(88 88 88)');
  });

  test('a channel colour is passed through as written', () => {
    expect(ansiSpans(`${ESC}[38;2;12;34;56mexact`)[0]?.style.color).toBe('rgb(12 34 56)');
  });

  test('a channel background leaves the foreground alone', () => {
    expect(ansiSpans(`${ESC}[31m${ESC}[48;2;0;0;0mboth`)[0]?.style).toMatchObject({
      color: 'var(--ansi-red)',
      backgroundColor: 'rgb(0 0 0)',
    });
  });
});

describe('inverse video is drawn as the swap it asks for', () => {
  test('a run with no colours of its own borrows the line and the page', () => {
    expect(ansiSpans(`${ESC}[7mselected`)[0]?.style).toMatchObject({
      color: 'var(--background)',
      backgroundColor: 'currentColor',
    });
  });

  test('a run with both colours swaps them', () => {
    expect(ansiSpans(`${ESC}[31;47;7mswapped`)[0]?.style).toMatchObject({
      color: 'var(--ansi-white)',
      backgroundColor: 'var(--ansi-red)',
    });
  });
});

/** The characters that were showing up in the middle of the line before any of this existed. */
describe('an escape that says nothing about colour is swallowed, not shown', () => {
  test('a cursor move leaves no characters behind', () => {
    expect(ansiSpans(`${ESC}[2Kredrawn`)).toEqual([{ offset: 4, text: 'redrawn', style: {} }]);
  });

  test('a private-mode escape leaves no characters behind', () => {
    expect(ansiSpans(`${ESC}[?25lhidden`)).toEqual([{ offset: 6, text: 'hidden', style: {} }]);
  });

  test('a window title is dropped along with what it named', () => {
    expect(ansiSpans(`${ESC}]0;my app\x07ready`)).toEqual([
      { offset: 11, text: 'ready', style: {} },
    ]);
  });
});
