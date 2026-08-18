import { useId } from 'react';

// The gradient runs from the theme's primary to the green its dark secondary-foreground
// already uses, but written literally: this is the brand's own artwork, and it has to survive
// on a marketing surface or a favicon where no theme token is in scope. Same for the ink —
// `currentColor` would turn the glyph white wherever the mark sits on a dark background.
const GRADIENT_FROM = '#16a34a';
const GRADIENT_TO = '#83fd9e';
const INK = '#0a0a0a';

export function NibrunMark({ className }: { className?: string }) {
  // Two marks on one page would otherwise share a gradient id, and the second would paint
  // with the first's definition.
  const gradientId = useId();

  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={GRADIENT_FROM} />
          <stop offset="100%" stopColor={GRADIENT_TO} />
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill={`url(#${gradientId})`} />
      <g
        transform="translate(256, 256) scale(23.75) translate(-8, -8)"
        fill="none"
        stroke={INK}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      >
        <rect width="3" height="4.5" x="3.25" y="1.75" />
        <path d="m9.75 6.25h3m-3-4.5h1.5v4" />
        <rect width="3" height="4.5" x="9.75" y="9.75" />
        <path d="m3.25 14.25h3m-3-4.5h1.5v4" />
      </g>
    </svg>
  );
}
