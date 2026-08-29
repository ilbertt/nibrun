import type { CSSProperties } from 'react';

/**
 * A run of characters the guest asked to be shown the same way.
 *
 * `offset` is where the run starts in the message it came out of, which is what makes it the one
 * thing about a run that stays true while the runs around it change.
 */
export type AnsiSpan = { offset: number; text: string; style: CSSProperties };

type Attributes = {
  foreground: string | undefined;
  background: string | undefined;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
};

const PLAIN: Attributes = {
  foreground: undefined,
  background: undefined,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
};

/**
 * Every escape a terminal would have swallowed, so that none of them is shown as text.
 *
 * Only the ones ending in `m` say anything about colour; a cursor move or a title change is still
 * matched, and dropped, because the alternative is the characters in the middle of the line.
 */
const ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape character is the thing being read
  /\x1b(?:\[(?<parameters>[\d;:?]*)(?<final>[a-zA-Z])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|.?)/g;

const SELECT_GRAPHIC_RENDITION = 'm';

export function ansiSpans(message: string): readonly AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let attributes = PLAIN;
  let read = 0;

  for (const sequence of message.matchAll(ESCAPE)) {
    append({ spans, attributes, text: message.slice(read, sequence.index), offset: read });
    read = sequence.index + sequence[0].length;
    if (sequence.groups?.final === SELECT_GRAPHIC_RENDITION) {
      attributes = restyle({ attributes, parameters: sequence.groups.parameters ?? '' });
    }
  }
  append({ spans, attributes, text: message.slice(read), offset: read });

  return spans;
}

function append({
  spans,
  attributes,
  text,
  offset,
}: {
  spans: AnsiSpan[];
  attributes: Attributes;
  text: string;
  offset: number;
}): void {
  if (text !== '') {
    spans.push({ offset, text, style: styleOf(attributes) });
  }
}

const RESET = 0;

function restyle({
  attributes,
  parameters,
}: {
  attributes: Attributes;
  parameters: string;
}): Attributes {
  const codes = parameters.split(';').map((code) => (code === '' ? RESET : Number(code)));
  let next = attributes;
  while (codes.length > 0) {
    next = consume({ attributes: next, codes });
  }
  return next;
}

const EXTENDED_FOREGROUND = 38;
const EXTENDED_BACKGROUND = 48;

function consume({ attributes, codes }: { attributes: Attributes; codes: number[] }): Attributes {
  const code = codes.shift() ?? RESET;
  if (code === EXTENDED_FOREGROUND) {
    return { ...attributes, foreground: takeExtendedColor(codes) };
  }
  if (code === EXTENDED_BACKGROUND) {
    return { ...attributes, background: takeExtendedColor(codes) };
  }
  const toggled = TOGGLES[code];
  return toggled === undefined ? recoloured({ attributes, code }) : { ...attributes, ...toggled };
}

const TOGGLES: Record<number, Partial<Attributes>> = {
  0: PLAIN,
  1: { bold: true },
  2: { dim: true },
  3: { italic: true },
  4: { underline: true },
  7: { inverse: true },
  9: { strikethrough: true },
  21: { bold: false },
  22: { bold: false, dim: false },
  23: { italic: false },
  24: { underline: false },
  27: { inverse: false },
  29: { strikethrough: false },
  39: { foreground: undefined },
  49: { background: undefined },
};

const PALETTE = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

const BRIGHT = PALETTE.length;

type Slot = { base: number; key: 'foreground' | 'background'; shift: number };

const SLOTS: readonly Slot[] = [
  { base: 30, key: 'foreground', shift: 0 },
  { base: 40, key: 'background', shift: 0 },
  { base: 90, key: 'foreground', shift: BRIGHT },
  { base: 100, key: 'background', shift: BRIGHT },
];

function recoloured({ attributes, code }: { attributes: Attributes; code: number }): Attributes {
  for (const slot of SLOTS) {
    const colour = code - slot.base;
    if (colour >= 0 && colour < PALETTE.length) {
      return { ...attributes, [slot.key]: paletteColor(colour + slot.shift) };
    }
  }
  return attributes;
}

function paletteColor(index: number): string {
  return `var(--ansi-${index >= BRIGHT ? 'bright-' : ''}${PALETTE[index % BRIGHT]})`;
}

const BY_INDEX = 5;
const BY_CHANNEL = 2;
const CHANNELS = 3;

function takeExtendedColor(codes: number[]): string | undefined {
  const kind = codes.shift();
  if (kind === BY_CHANNEL) {
    return `rgb(${codes.splice(0, CHANNELS).join(' ')})`;
  }
  const index = kind === BY_INDEX ? codes.shift() : undefined;
  return index === undefined ? undefined : indexedColor(index);
}

const NAMED = 16;
const CUBE_SIDE = 6;
const CUBE_FLOOR = 55;
const CUBE_STEP = 40;
const GRAYS_FROM = 232;
const GRAY_FLOOR = 8;
const GRAY_STEP = 10;

/** The 256-colour table: the sixteen named ones, then a 6×6×6 cube, then a ramp of grays. */
function indexedColor(index: number): string {
  if (index < NAMED) {
    return paletteColor(index);
  }
  if (index >= GRAYS_FROM) {
    const gray = GRAY_FLOOR + (index - GRAYS_FROM) * GRAY_STEP;
    return `rgb(${gray} ${gray} ${gray})`;
  }
  const cube = index - NAMED;
  const red = cubeLevel(Math.floor(cube / (CUBE_SIDE * CUBE_SIDE)));
  const green = cubeLevel(Math.floor(cube / CUBE_SIDE) % CUBE_SIDE);
  const blue = cubeLevel(cube % CUBE_SIDE);
  return `rgb(${red} ${green} ${blue})`;
}

/** Evenly spaced above a floor the darkest step never reaches, which is why it is not a step. */
function cubeLevel(step: number): number {
  return step === 0 ? 0 : CUBE_FLOOR + step * CUBE_STEP;
}

const DIM_OPACITY = 0.65;

function styleOf(attributes: Attributes): CSSProperties {
  const { foreground, background } = sided(attributes);
  return {
    color: foreground,
    backgroundColor: background,
    fontWeight: attributes.bold ? 'bold' : undefined,
    fontStyle: attributes.italic ? 'italic' : undefined,
    opacity: attributes.dim ? DIM_OPACITY : undefined,
    textDecoration: decorationOf(attributes),
  };
}

/**
 * Inverse video, which is the one attribute that needs the colours it is not given: a run that
 * only asked to be swapped is drawn as the line's own colour on the page the line sits on.
 */
function sided(attributes: Attributes): { foreground?: string; background?: string } {
  if (!attributes.inverse) {
    return { foreground: attributes.foreground, background: attributes.background };
  }
  return {
    foreground: attributes.background ?? 'var(--background)',
    background: attributes.foreground ?? 'currentColor',
  };
}

function decorationOf({ underline, strikethrough }: Attributes): string | undefined {
  const marks: string[] = [];
  if (underline) {
    marks.push('underline');
  }
  if (strikethrough) {
    marks.push('line-through');
  }
  return marks.length === 0 ? undefined : marks.join(' ');
}
