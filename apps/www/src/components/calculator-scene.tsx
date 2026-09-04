import { cn } from '@repo/ui/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { type AppSpec, AXES, AXIS_KEYS, type AxisKey } from '#lib/calculator.ts';

type Vec3 = { x: number; y: number; z: number };
type Point = { px: number; py: number };
type Segment = { from: Vec3; to: Vec3 };

type FlatMode = AxisKey;
type ViewMode = 'iso' | FlatMode;

const EDGE_ANGLE_DEG = 30;
const RIGHT_ANGLE_DEG = 90;
const HALF_TURN_DEG = 180;
const HALF = 0.5;

function radians(degrees: number): number {
  return (degrees * Math.PI) / HALF_TURN_DEG;
}

const EDGE_COS = Math.cos(radians(EDGE_ANGLE_DEG));
const EDGE_SIN = Math.sin(radians(EDGE_ANGLE_DEG));

const UNIT_PX = 44;

// The view is fitted to the room, so anything meant to look the same on screen at every room
// size — text, gaps, hairlines — is a fraction of the frame rather than a length.
const PAD_RATIO = 0.11;
const TITLE_GAP_RATIO = 0.045;
const GRID_STROKE_RATIO = 0.0013;
const BOX_STROKE_RATIO = 0.0018;

const FULL_PERCENT = 100;

/** Held fixed so the drawing keeps its shape as the room grows under it. */
const VIEW_ASPECT = 1.35;

/** The room a single default box stands in, so one box is never the whole room. */
const MIN_ROOM: Vec3 = { x: 8, y: 6, z: 6 };

const ROW_WIDTH = MIN_ROOM.x;
const STACK_LIMIT = 10;

const AXIS_COORD: Record<AxisKey, keyof Vec3> = { vcpu: 'x', memory: 'y', volume: 'z' };

type Projection = { x: Point; y: Point; z: Point };

// Each view is the contribution one unit of each axis makes to the screen. A flat view simply
// contributes nothing on the axis it looks along.
const VIEWS: Record<ViewMode, Projection> = {
  iso: {
    x: { px: EDGE_COS * UNIT_PX, py: EDGE_SIN * UNIT_PX },
    y: { px: 0, py: -UNIT_PX },
    z: { px: -EDGE_COS * UNIT_PX, py: EDGE_SIN * UNIT_PX },
  },
  vcpu: {
    x: { px: 0, py: 0 },
    y: { px: 0, py: -UNIT_PX },
    z: { px: UNIT_PX, py: 0 },
  },
  memory: {
    x: { px: UNIT_PX, py: 0 },
    y: { px: 0, py: 0 },
    z: { px: 0, py: UNIT_PX },
  },
  volume: {
    x: { px: UNIT_PX, py: 0 },
    y: { px: 0, py: -UNIT_PX },
    z: { px: 0, py: 0 },
  },
};

type FlatPair = { across: AxisKey; up: AxisKey };

const FLAT_PAIRS: Record<FlatMode, FlatPair> = {
  vcpu: { across: 'volume', up: 'memory' },
  memory: { across: 'vcpu', up: 'volume' },
  volume: { across: 'vcpu', up: 'memory' },
};

function project({ point, view }: { point: Vec3; view: Projection }): Point {
  return {
    px: point.x * view.x.px + point.y * view.y.px + point.z * view.z.px,
    py: point.x * view.x.py + point.y * view.y.py + point.z * view.z.py,
  };
}

function polygonPoints({ vertices, view }: { vertices: Vec3[]; view: Projection }): string {
  return vertices
    .map((point) => {
      const { px, py } = project({ point, view });
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ');
}

function planePoint({ pair, across, up }: { pair: FlatPair; across: number; up: number }): Vec3 {
  const point: Vec3 = { x: 0, y: 0, z: 0 };
  point[AXIS_COORD[pair.across]] = across;
  point[AXIS_COORD[pair.up]] = up;
  return point;
}

function ticksUpTo(count: number): number[] {
  const ticks: number[] = [];
  for (let tick = 0; tick <= count; tick += 1) {
    ticks.push(tick);
  }
  return ticks;
}

function extentsOf(app: AppSpec): Vec3 {
  return { x: app.steps.vcpu + 1, y: app.steps.memory + 1, z: app.steps.volume + 1 };
}

type Placement = { app: AppSpec; origin: Vec3; size: Vec3 };
type Room = { placements: Placement[]; size: Vec3 };

// biome-ignore lint/complexity/useMaxParams: a comparator compares two boxes
function byBiggestFirst(a: AppSpec, b: AppSpec): number {
  const left = extentsOf(a);
  const right = extentsOf(b);
  return right.y - left.y || right.z - left.z || right.x - left.x;
}

/** The lowest free top wide and deep enough to carry the box, so piles stay short. */
function findSupport({
  placements,
  taken,
  size,
}: {
  placements: Placement[];
  taken: Set<Placement>;
  size: Vec3;
}): Placement | null {
  let best: Placement | null = null;
  for (const candidate of placements) {
    const fits =
      !taken.has(candidate) &&
      candidate.size.x >= size.x &&
      candidate.size.z >= size.z &&
      candidate.origin.y + candidate.size.y + size.y <= STACK_LIMIT;
    if (fits && (best === null || candidate.origin.y < best.origin.y)) {
      best = candidate;
    }
  }
  return best;
}

// Boxes pack flush against each other, biggest first: along the back wall while the row has
// width, then on top of something that can carry them, and only then into a new row.
function packRoom(apps: AppSpec[]): Room {
  const placements: Placement[] = [];
  const taken = new Set<Placement>();
  let rowX = 0;
  let rowZ = 0;
  let rowDepth = 0;

  for (const app of [...apps].sort(byBiggestFirst)) {
    const size = extentsOf(app);
    const support = rowX + size.x <= ROW_WIDTH ? null : findSupport({ placements, taken, size });

    if (support !== null) {
      taken.add(support);
      const origin = {
        x: support.origin.x,
        y: support.origin.y + support.size.y,
        z: support.origin.z,
      };
      placements.push({ app, origin, size });
      continue;
    }

    if (rowX + size.x > ROW_WIDTH) {
      rowZ += rowDepth;
      rowX = 0;
      rowDepth = 0;
    }
    placements.push({ app, origin: { x: rowX, y: 0, z: rowZ }, size });
    rowX += size.x;
    rowDepth = Math.max(rowDepth, size.z);
  }

  return {
    placements,
    size: {
      x: Math.max(MIN_ROOM.x, ...placements.map((one) => one.origin.x + one.size.x)),
      y: Math.max(MIN_ROOM.y, ...placements.map((one) => one.origin.y + one.size.y)),
      z: Math.max(MIN_ROOM.z, ...placements.map((one) => one.origin.z + one.size.z)),
    },
  };
}

/** How near the eye a box is: along a flat view that is only its depth on the dropped axis. */
function depthOf({ placement, mode }: { placement: Placement; mode: ViewMode }): number {
  if (mode === 'iso') {
    return placement.origin.x + placement.origin.y + placement.origin.z;
  }
  return placement.origin[AXIS_COORD[mode]];
}

type Sorted = { placement: Placement; depth: number };

// biome-ignore lint/complexity/useMaxParams: a comparator compares two placements
function byNearestLast(a: Sorted, b: Sorted): number {
  return a.depth - b.depth;
}

function roomSurfaces({ room, mode }: { room: Vec3; mode: ViewMode }): Vec3[][] {
  if (mode !== 'iso') {
    const pair = FLAT_PAIRS[mode];
    const across = room[AXIS_COORD[pair.across]];
    const up = room[AXIS_COORD[pair.up]];
    return [
      [
        planePoint({ pair, across: 0, up: 0 }),
        planePoint({ pair, across, up: 0 }),
        planePoint({ pair, across, up }),
        planePoint({ pair, across: 0, up }),
      ],
    ];
  }
  return [
    [
      { x: 0, y: 0, z: 0 },
      { x: room.x, y: 0, z: 0 },
      { x: room.x, y: 0, z: room.z },
      { x: 0, y: 0, z: room.z },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: room.y, z: 0 },
      { x: 0, y: room.y, z: room.z },
      { x: 0, y: 0, z: room.z },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: room.y, z: 0 },
      { x: room.x, y: room.y, z: 0 },
      { x: room.x, y: 0, z: 0 },
    ],
  ];
}

function segmentKey({ from, to }: Segment): string {
  return [from, to]
    .map((vertex) => `${vertex.x},${vertex.y},${vertex.z}`)
    .sort()
    .join('|');
}

// The floor and the two walls each contribute the three edges they share with a neighbour.
function withoutSharedEdges(segments: Segment[]): Segment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = segmentKey(segment);
    const unseen = !seen.has(key);
    seen.add(key);
    return unseen;
  });
}

function flatGrid({ room, mode }: { room: Vec3; mode: FlatMode }): Segment[] {
  const pair = FLAT_PAIRS[mode];
  const across = room[AXIS_COORD[pair.across]];
  const up = room[AXIS_COORD[pair.up]];
  return [
    ...ticksUpTo(across).map((at) => ({
      from: planePoint({ pair, across: at, up: 0 }),
      to: planePoint({ pair, across: at, up }),
    })),
    ...ticksUpTo(up).map((at) => ({
      from: planePoint({ pair, across: 0, up: at }),
      to: planePoint({ pair, across, up: at }),
    })),
  ];
}

function isoGrid(room: Vec3): Segment[] {
  const xs = ticksUpTo(room.x);
  const ys = ticksUpTo(room.y);
  const zs = ticksUpTo(room.z);
  return withoutSharedEdges([
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: 0, z: room.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: room.x, y: 0, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: 0, y, z: room.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: 0, y: room.y, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: room.x, y, z: 0 } })),
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: room.y, z: 0 } })),
  ]);
}

function roomGrid({ room, mode }: { room: Vec3; mode: ViewMode }): Segment[] {
  return mode === 'iso' ? isoGrid(room) : flatGrid({ room, mode });
}

const TOP_MIX = 'white 18%';
const LEFT_MIX = 'black 20%';

type Face = { id: string; mix: string | null; vertices: Vec3[] };

function isoFaces({ origin, size }: { origin: Vec3; size: Vec3 }): Face[] {
  const x0 = origin.x;
  const x1 = origin.x + size.x;
  const y0 = origin.y;
  const y1 = origin.y + size.y;
  const z0 = origin.z;
  const z1 = origin.z + size.z;
  return [
    {
      id: 'top',
      mix: TOP_MIX,
      vertices: [
        { x: x0, y: y1, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z1 },
      ],
    },
    {
      id: 'right',
      mix: null,
      vertices: [
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y0, z: z1 },
      ],
    },
    {
      id: 'left',
      mix: LEFT_MIX,
      vertices: [
        { x: x0, y: y0, z: z1 },
        { x: x0, y: y1, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y0, z: z1 },
      ],
    },
  ];
}

function flatFace({ origin, size, mode }: { origin: Vec3; size: Vec3; mode: FlatMode }): Face {
  const pair = FLAT_PAIRS[mode];
  const across = AXIS_COORD[pair.across];
  const up = AXIS_COORD[pair.up];
  const a0 = origin[across];
  const a1 = a0 + size[across];
  const u0 = origin[up];
  const u1 = u0 + size[up];
  return {
    id: 'flat',
    mix: null,
    vertices: [
      planePoint({ pair, across: a0, up: u0 }),
      planePoint({ pair, across: a1, up: u0 }),
      planePoint({ pair, across: a1, up: u1 }),
      planePoint({ pair, across: a0, up: u1 }),
    ],
  };
}

function boxShapes({ origin, size, mode }: { origin: Vec3; size: Vec3; mode: ViewMode }): Face[] {
  return mode === 'iso' ? isoFaces({ origin, size }) : [flatFace({ origin, size, mode })];
}

function shaded({ tint, mix }: { tint: string; mix: string | null }): string {
  if (mix === null) {
    return tint;
  }
  return `color-mix(in oklch, ${tint}, ${mix})`;
}

function offsetBy({ point, by }: { point: Point; by: Point }): Point {
  return { px: point.px + by.px, py: point.py + by.py };
}

function scaled({ direction, by }: { direction: Point; by: number }): Point {
  return { px: direction.px * by, py: direction.py * by };
}

// A title sits on the outward normal of the edge it names, so it clears the room at the same
// distance whatever the projection does to that edge on screen.
const ISO_NORMALS: Record<AxisKey, Point> = {
  vcpu: { px: -EDGE_SIN, py: EDGE_COS },
  volume: { px: EDGE_SIN, py: EDGE_COS },
  memory: { px: -1, py: 0 },
};

const ISO_ROTATIONS: Record<AxisKey, number> = {
  vcpu: EDGE_ANGLE_DEG,
  volume: -EDGE_ANGLE_DEG,
  memory: -RIGHT_ANGLE_DEG,
};

function isoTitleAnchor({ axisKey, room }: { axisKey: AxisKey; room: Vec3 }): Vec3 {
  if (axisKey === 'vcpu') {
    return { x: room.x * HALF, y: 0, z: room.z };
  }
  if (axisKey === 'volume') {
    return { x: room.x, y: 0, z: room.z * HALF };
  }
  return { x: 0, y: room.y * HALF, z: room.z };
}

type Label = { axisKey: AxisKey; at: Point; rotate: number; text: string };

function isoLabels({ room, gap }: { room: Vec3; gap: number }): Label[] {
  return AXIS_KEYS.map((axisKey) => ({
    axisKey,
    at: offsetBy({
      point: project({ point: isoTitleAnchor({ axisKey, room }), view: VIEWS.iso }),
      by: scaled({ direction: ISO_NORMALS[axisKey], by: gap }),
    }),
    rotate: ISO_ROTATIONS[axisKey],
    text: AXES[axisKey].name,
  }));
}

// Which way is up on screen depends on the projection, so a flat view's labels are hung off the
// drawing's own bounds: the axis looked along above it, the other two below and to its left.
function flatLabels({ room, mode, gap }: { room: Vec3; mode: FlatMode; gap: number }): Label[] {
  const pair = FLAT_PAIRS[mode];
  const view = VIEWS[mode];
  const corners = [0, room.x].flatMap((x) =>
    [0, room.y].flatMap((y) => [0, room.z].map((z) => project({ point: { x, y, z }, view }))),
  );
  const xs = corners.map((corner) => corner.px);
  const ys = corners.map((corner) => corner.py);
  const midX = (Math.min(...xs) + Math.max(...xs)) * HALF;
  const midY = (Math.min(...ys) + Math.max(...ys)) * HALF;

  return [
    {
      axisKey: mode,
      at: { px: midX, py: Math.min(...ys) - gap },
      rotate: 0,
      text: AXES[mode].name,
    },
    {
      axisKey: pair.across,
      at: { px: midX, py: Math.max(...ys) + gap },
      rotate: 0,
      text: AXES[pair.across].name,
    },
    {
      axisKey: pair.up,
      at: { px: Math.min(...xs) - gap, py: midY },
      rotate: -RIGHT_ANGLE_DEG,
      text: AXES[pair.up].name,
    },
  ];
}

function labelsFor({ room, mode, gap }: { room: Vec3; mode: ViewMode; gap: number }): Label[] {
  return mode === 'iso' ? isoLabels({ room, gap }) : flatLabels({ room, mode, gap });
}

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
  titleGap: number;
  gridStroke: number;
  boxStroke: number;
};

function frameFor({ room, mode }: { room: Vec3; mode: ViewMode }): Frame {
  const view = VIEWS[mode];
  const corners = [0, room.x].flatMap((x) =>
    [0, room.y].flatMap((y) => [0, room.z].map((z) => project({ point: { x, y, z }, view }))),
  );
  const xs = corners.map((corner) => corner.px);
  const ys = corners.map((corner) => corner.py);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const pad = Math.max(spanX, spanY) * PAD_RATIO;

  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;

  const width = Math.max(maxX - minX, (maxY - minY) * VIEW_ASPECT);
  const height = width / VIEW_ASPECT;

  return {
    left: (minX + maxX) * HALF - width * HALF,
    top: (minY + maxY) * HALF - height * HALF,
    width,
    height,
    titleGap: width * TITLE_GAP_RATIO,
    gridStroke: width * GRID_STROKE_RATIO,
    boxStroke: width * BOX_STROKE_RATIO,
  };
}

const EASE_FACTOR = 0.22;
const SETTLED_EPSILON = 0.004;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function easeToward({ from, to }: { from: Vec3; to: Vec3 }): Vec3 {
  return {
    x: from.x + (to.x - from.x) * EASE_FACTOR,
    y: from.y + (to.y - from.y) * EASE_FACTOR,
    z: from.z + (to.z - from.z) * EASE_FACTOR,
  };
}

function isSettled({ from, to }: { from: Vec3; to: Vec3 }): boolean {
  return (
    Math.abs(to.x - from.x) < SETTLED_EPSILON &&
    Math.abs(to.y - from.y) < SETTLED_EPSILON &&
    Math.abs(to.z - from.z) < SETTLED_EPSILON
  );
}

// SVG geometry cannot be transitioned in CSS, so a box slides and grows one frame at a time.
function useEasedVec3(target: Vec3): Vec3 {
  const { x, y, z } = target;
  const [current, setCurrent] = useState(target);
  const latest = useRef(target);

  useEffect(() => {
    const to = { x, y, z };
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      latest.current = to;
      setCurrent(to);
      return;
    }

    let frame = 0;
    function step() {
      const next = easeToward({ from: latest.current, to });
      const settled = isSettled({ from: next, to });
      latest.current = settled ? to : next;
      setCurrent(latest.current);
      if (!settled) {
        frame = requestAnimationFrame(step);
      }
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [x, y, z]);

  return current;
}

const NEUTRAL_FILL_OPACITY = 0.82;
const ACTIVE_FILL_OPACITY = 1;
const DIMMED_FILL_OPACITY = 0.25;
const NEUTRAL_STROKE_OPACITY = 0.9;
const ACTIVE_STROKE_OPACITY = 1;
const DIMMED_STROKE_OPACITY = 0.3;

type Emphasis = 'neutral' | 'active' | 'dimmed';

const FILL_OPACITY: Record<Emphasis, number> = {
  neutral: NEUTRAL_FILL_OPACITY,
  active: ACTIVE_FILL_OPACITY,
  dimmed: DIMMED_FILL_OPACITY,
};

const STROKE_OPACITY: Record<Emphasis, number> = {
  neutral: NEUTRAL_STROKE_OPACITY,
  active: ACTIVE_STROKE_OPACITY,
  dimmed: DIMMED_STROKE_OPACITY,
};

function AppBox({
  placement,
  emphasis,
  mode,
  stroke,
}: {
  placement: Placement;
  emphasis: Emphasis;
  mode: ViewMode;
  stroke: number;
}) {
  const origin = useEasedVec3(placement.origin);
  const size = useEasedVec3(placement.size);
  const { tint } = placement.app;
  const view = VIEWS[mode];
  const faces = boxShapes({ origin, size, mode });

  return (
    <g className="transition-[fill-opacity,stroke-opacity] duration-200">
      <g fillOpacity={FILL_OPACITY[emphasis]}>
        {faces.map((face) => (
          <polygon
            key={face.id}
            points={polygonPoints({ vertices: face.vertices, view })}
            fill={shaded({ tint, mix: face.mix })}
          />
        ))}
      </g>
      <g
        fill="none"
        stroke={shaded({ tint, mix: LEFT_MIX })}
        strokeOpacity={STROKE_OPACITY[emphasis]}
        strokeWidth={stroke}
        strokeLinejoin="round"
      >
        {faces.map((face) => (
          <polygon key={face.id} points={polygonPoints({ vertices: face.vertices, view })} />
        ))}
      </g>
    </g>
  );
}

function emphasisFor({
  ordinal,
  highlighted,
}: {
  ordinal: number;
  highlighted: number | null;
}): Emphasis {
  if (highlighted === null) {
    return 'neutral';
  }
  return highlighted === ordinal ? 'active' : 'dimmed';
}

// A real button rather than SVG text: the drawing is decorative, and the label is placed over it
// by mapping its position in the frame onto the box the SVG is drawn in.
function AxisLabel({
  label,
  frame,
  active,
  onSelect,
}: {
  label: Label;
  frame: Frame;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={active ? 'Back to the room' : `Look along ${label.text}`}
      style={{
        left: `${((label.at.px - frame.left) / frame.width) * FULL_PERCENT}%`,
        top: `${((label.at.py - frame.top) / frame.height) * FULL_PERCENT}%`,
        transform: `translate(-50%, -50%) rotate(${label.rotate}deg)`,
      }}
      className={cn(
        'absolute rounded-md px-1.5 py-0.5 text-xs underline decoration-dotted underline-offset-4 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
        active
          ? 'bg-muted font-medium text-foreground decoration-solid'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label.text}
    </button>
  );
}

export function CalculatorScene({
  apps,
  highlighted,
}: {
  apps: AppSpec[];
  highlighted: number | null;
}) {
  const [mode, setMode] = useState<ViewMode>('iso');
  const { placements, size: room } = packRoom(apps);
  const frame = frameFor({ room, mode });
  const view = VIEWS[mode];

  const ordered = placements
    .map((placement) => ({ placement, depth: depthOf({ placement, mode }) }))
    .sort(byNearestLast);

  return (
    <div className="relative">
      <svg
        viewBox={`${frame.left} ${frame.top} ${frame.width} ${frame.height}`}
        aria-hidden="true"
        className="h-auto w-full select-none"
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="fill-muted/60">
          {roomSurfaces({ room, mode }).map((surface) => (
            <polygon
              key={polygonPoints({ vertices: surface, view })}
              points={polygonPoints({ vertices: surface, view })}
            />
          ))}
        </g>
        <g className="stroke-border" strokeWidth={frame.gridStroke}>
          {roomGrid({ room, mode }).map((segment) => {
            const from = project({ point: segment.from, view });
            const to = project({ point: segment.to, view });
            return (
              <line key={segmentKey(segment)} x1={from.px} y1={from.py} x2={to.px} y2={to.py} />
            );
          })}
        </g>
        {ordered.map(({ placement }) => (
          <AppBox
            key={placement.app.ordinal}
            placement={placement}
            emphasis={emphasisFor({ ordinal: placement.app.ordinal, highlighted })}
            mode={mode}
            stroke={frame.boxStroke}
          />
        ))}
      </svg>
      {labelsFor({ room, mode, gap: frame.titleGap }).map((label) => (
        <AxisLabel
          key={label.axisKey}
          label={label}
          frame={frame}
          active={mode === label.axisKey}
          onSelect={() => setMode(mode === label.axisKey ? 'iso' : label.axisKey)}
        />
      ))}
    </div>
  );
}
