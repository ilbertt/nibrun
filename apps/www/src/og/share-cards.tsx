import { BASE_DOMAIN, PRODUCT_NAME, WWW_SITE } from '@repo/global-constants';
import { GithubMark } from '@repo/ui/custom/github-mark';
import type { ReactElement, ReactNode } from 'react';
import { APPS, appCardPath, CATALOG, type CatalogApp, repoName } from '#lib/apps.ts';
import markSvg from '../../../../brand/logo.svg?raw';

// The site's dark palette, written out: satori reads no stylesheet and no `oklch()`, so the
// tokens cannot be referenced — only copied, and the dark scheme is the one a card is seen in.
const COLOR = {
  background: '#0b1009',
  foreground: '#f4f3f0',
  muted: '#a7aea0',
  dots: '#465048',
  border: '#343c33',
  primary: '#16a34a',
  primaryForeground: '#fcfcf7',
};

const SANS = 'Space Grotesk';
const MONO = 'Space Mono';

const MARK_SIZE = 44;
const DOT_SPACING = 28;
const DOT_RADIUS = 1.5;
const CHIP_HEIGHT = 48;
const CHIP_GAP = 12;
// Whole rows, so the catalog outgrowing the card drops the rows that do not fit rather than
// slicing a chip in half — the tally leading them says how many there are.
const CHIP_ROWS = 2;

// An SVG pattern rather than the page's repeating `radial-gradient`: satori scales a gradient's
// stops against the whole box instead of one tile, and the dots come out too small to see.
function Backdrop() {
  return (
    <svg
      aria-hidden="true"
      width={WWW_SITE.ogImage.width}
      height={WWW_SITE.ogImage.height}
      viewBox={`0 0 ${WWW_SITE.ogImage.width} ${WWW_SITE.ogImage.height}`}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <defs>
        <pattern id="dots" width={DOT_SPACING} height={DOT_SPACING} patternUnits="userSpaceOnUse">
          <circle cx={DOT_SPACING / 2} cy={DOT_SPACING / 2} r={DOT_RADIUS} fill={COLOR.dots} />
        </pattern>
        <radialGradient id="fade" cx="100%" cy="0%" r="90%">
          <stop offset="0%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>
        <mask id="faded">
          <rect width="100%" height="100%" fill="url(#fade)" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#dots)" mask="url(#faded)" />
    </svg>
  );
}

function Frame({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: 72,
        backgroundColor: COLOR.background,
        color: COLOR.foreground,
        fontFamily: SANS,
      }}
    >
      <Backdrop />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 32, fontWeight: 600 }}
        >
          <img
            src={`data:image/svg+xml,${encodeURIComponent(markSvg)}`}
            width={MARK_SIZE}
            height={MARK_SIZE}
            alt=""
          />
          {PRODUCT_NAME}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 22, color: COLOR.muted }}>
          {`${BASE_DOMAIN}${path}`}
        </div>
      </div>
      <div
        style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }}
      >
        {children}
      </div>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.05 }}>
      {children}
    </div>
  );
}

function Lede({ children }: { children: string }) {
  return (
    <div
      style={{
        marginTop: 24,
        fontSize: 34,
        lineHeight: 1.35,
        color: COLOR.muted,
        textWrap: 'balance',
      }}
    >
      {children}
    </div>
  );
}

function AppCard({ app }: { app: CatalogApp }) {
  return (
    <Frame path={`/apps/${app.slug}`}>
      <Heading>{`Deploy ${app.title}`}</Heading>
      <Lede>{app.subtitle}</Lede>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 56,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: MONO,
            fontSize: 24,
            color: COLOR.muted,
          }}
        >
          <GithubMark width={28} height={28} fill={COLOR.muted} />
          {`${repoName(app)} · ${app.version}`}
        </div>
        <div
          style={{
            display: 'flex',
            padding: '14px 28px',
            borderRadius: 8,
            backgroundColor: COLOR.primary,
            color: COLOR.primaryForeground,
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          {`Deploy on ${PRODUCT_NAME}`}
        </div>
      </div>
    </Frame>
  );
}

/** Filled for the tally, the way the page fills the chip whose count is on screen. */
function Chip({ children, filled }: { children: string; filled: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: CHIP_HEIGHT,
        padding: '0 20px',
        border: `2px solid ${filled ? COLOR.primary : COLOR.border}`,
        borderRadius: CHIP_HEIGHT,
        backgroundColor: filled ? COLOR.primary : 'transparent',
        color: filled ? COLOR.primaryForeground : COLOR.foreground,
        fontFamily: MONO,
        fontSize: 22,
      }}
    >
      {children}
    </div>
  );
}

function CatalogCard() {
  return (
    <Frame path="/apps">
      <Heading>{CATALOG.heading}</Heading>
      <Lede>{CATALOG.description}</Lede>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: CHIP_GAP,
          marginTop: 40,
          height: CHIP_ROWS * CHIP_HEIGHT + (CHIP_ROWS - 1) * CHIP_GAP,
          overflow: 'hidden',
        }}
      >
        <Chip filled={true}>{`${APPS.length} apps`}</Chip>
        {APPS.map((app) => (
          <Chip key={app.slug} filled={false}>
            {app.title}
          </Chip>
        ))}
      </div>
    </Frame>
  );
}

/** Every card the site serves, by the address the page naming it as its `og:image` gives. */
export const SHARE_CARDS: ReadonlyMap<string, ReactElement> = new Map([
  [CATALOG.cardPath, <CatalogCard key={CATALOG.cardPath} />],
  ...APPS.map((app): [string, ReactElement] => [
    appCardPath(app),
    <AppCard key={app.slug} app={app} />,
  ]),
]);
