import { useEffect, useRef, useState } from 'react';
import { type AppSpec, AXES, AXIS_KEYS, type AxisKey } from '#lib/calculator.ts';

type Vec3 = { x: number; y: number; z: number };
type Point = { px: number; py: number };
type Segment = { from: Vec3; to: Vec3 };

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
// size — gaps, hairlines — is a fraction of the frame rather than a length.
const PAD_RATIO = 0.11;
const FONT_RATIO = 0.019;
const TITLE_GAP_RATIO = 0.038;
const GRID_STROKE_RATIO = 0.0013;
const BOX_STROKE_RATIO = 0.0018;

/** Held fixed so the drawing keeps its shape as the room fills up. */
const VIEW_ASPECT = 1.35;

/**
 * Fixed, so the drawing holds still and what is left of it is space you can actually take. Deep
 * enough that the widest fleet the limits allow — three boxes grown all the way — still stands
 * on the floor rather than pushing the walls out.
 */
const ROOM: Vec3 = { x: 8, y: 6, z: 10 };

const STACK_LIMIT = ROOM.y;

function project({ x, y, z }: Vec3): Point {
  return { px: (x - z) * EDGE_COS * UNIT_PX, py: ((x + z) * EDGE_SIN - y) * UNIT_PX };
}

function polygonPoints(vertices: Vec3[]): string {
  return vertices
    .map((vertex) => {
      const { px, py } = project(vertex);
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ');
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

/** The shallowest place on the floor this box fits, and the leftmost of those. */
function bestSpot({ front, size }: { front: number[]; size: Vec3 }): Vec3 | null {
  let best: Vec3 | null = null;
  for (let x = 0; x + size.x <= front.length; x += 1) {
    const z = Math.max(...front.slice(x, x + size.x));
    if (z + size.z <= ROOM.z && (best === null || z < best.z)) {
      best = { x, y: 0, z };
    }
  }
  return best;
}

// Boxes tile the floor rather than lining up along the back wall: each one takes the shallowest
// place it fits, which is what makes the floor in front of a shallow box somewhere the next box
// can go. Only when nothing on the floor will hold it does it go on top of something.
function packRoom(apps: AppSpec[]): Room {
  const front = new Array<number>(ROOM.x).fill(0);
  const placed: Placement[] = [];
  const taken = new Set<Placement>();

  for (const app of [...apps].sort(byBiggestFirst)) {
    const size = extentsOf(app);
    const spot = bestSpot({ front, size });
    const support = spot === null ? findSupport({ placements: placed, taken, size }) : null;

    if (support !== null) {
      taken.add(support);
      placed.push({
        app,
        origin: {
          x: support.origin.x,
          y: support.origin.y + support.size.y,
          z: support.origin.z + support.size.z - size.z,
        },
        size,
      });
      continue;
    }

    // Nothing fits anywhere: the room takes the overflow rather than the box going missing.
    const at = spot ?? { x: 0, y: 0, z: Math.max(...front) };
    placed.push({ app, origin: at, size });
    for (let column = at.x; column < at.x + size.x; column += 1) {
      front[column] = at.z + size.z;
    }
  }

  return {
    placements: placed,
    size: {
      x: Math.max(ROOM.x, ...placed.map((one) => one.origin.x + one.size.x)),
      y: Math.max(ROOM.y, ...placed.map((one) => one.origin.y + one.size.y)),
      z: Math.max(ROOM.z, ...placed.map((one) => one.origin.z + one.size.z)),
    },
  };
}

type Sorted = { placement: Placement; depth: number };

// biome-ignore lint/complexity/useMaxParams: a comparator compares two placements
function byNearestLast(a: Sorted, b: Sorted): number {
  return a.depth - b.depth;
}

function roomSurfaces(room: Vec3): Vec3[][] {
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

function roomGrid(room: Vec3): Segment[] {
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

const TOP_MIX = 'white 18%';
const LEFT_MIX = 'black 20%';

type Face = { id: string; mix: string | null; vertices: Vec3[] };

function boxFaces({ origin, size }: { origin: Vec3; size: Vec3 }): Face[] {
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
// distance whatever the isometric skew does to that edge on screen.
const AXIS_NORMALS: Record<AxisKey, Point> = {
  vcpu: { px: -EDGE_SIN, py: EDGE_COS },
  volume: { px: EDGE_SIN, py: EDGE_COS },
  memory: { px: -1, py: 0 },
};

const AXIS_ROTATIONS: Record<AxisKey, number> = {
  vcpu: EDGE_ANGLE_DEG,
  volume: -EDGE_ANGLE_DEG,
  memory: -RIGHT_ANGLE_DEG,
};

function titleAnchor({ axisKey, room }: { axisKey: AxisKey; room: Vec3 }): Vec3 {
  if (axisKey === 'vcpu') {
    return { x: room.x * HALF, y: 0, z: room.z };
  }
  if (axisKey === 'volume') {
    return { x: room.x, y: 0, z: room.z * HALF };
  }
  return { x: 0, y: room.y * HALF, z: room.z };
}

type Label = { axisKey: AxisKey; at: Point; rotate: number; text: string };

function axisLabels({ room, gap }: { room: Vec3; gap: number }): Label[] {
  return AXIS_KEYS.map((axisKey) => ({
    axisKey,
    at: offsetBy({
      point: project(titleAnchor({ axisKey, room })),
      by: scaled({ direction: AXIS_NORMALS[axisKey], by: gap }),
    }),
    rotate: AXIS_ROTATIONS[axisKey],
    text: AXES[axisKey].name,
  }));
}

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  titleGap: number;
  gridStroke: number;
  boxStroke: number;
};

function frameFor(room: Vec3): Frame {
  const corners = [0, room.x].flatMap((x) =>
    [0, room.y].flatMap((y) => [0, room.z].map((z) => project({ x, y, z }))),
  );
  const xs = corners.map((corner) => corner.px);
  const ys = corners.map((corner) => corner.py);
  const pad =
    Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * PAD_RATIO;

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
    fontSize: width * FONT_RATIO,
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

const NEUTRAL_FILL_OPACITY = 1;
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
  stroke,
}: {
  placement: Placement;
  emphasis: Emphasis;
  stroke: number;
}) {
  const origin = useEasedVec3(placement.origin);
  const size = useEasedVec3(placement.size);
  const { tint } = placement.app;
  const faces = boxFaces({ origin, size });

  return (
    <g className="transition-[fill-opacity,stroke-opacity] duration-200">
      <g fillOpacity={FILL_OPACITY[emphasis]}>
        {faces.map((face) => (
          <polygon
            key={face.id}
            points={polygonPoints(face.vertices)}
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
          <polygon key={face.id} points={polygonPoints(face.vertices)} />
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

export function CalculatorScene({
  apps,
  highlighted,
}: {
  apps: AppSpec[];
  highlighted: number | null;
}) {
  const { placements, size: room } = packRoom(apps);
  const frame = frameFor(room);

  const ordered = placements
    .map((placement) => ({
      placement,
      depth: placement.origin.x + placement.origin.y + placement.origin.z,
    }))
    .sort(byNearestLast);

  return (
    <svg
      viewBox={`${frame.left} ${frame.top} ${frame.width} ${frame.height}`}
      aria-hidden="true"
      className="h-auto w-full select-none lg:h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="fill-muted/60">
        {roomSurfaces(room).map((surface) => (
          <polygon key={polygonPoints(surface)} points={polygonPoints(surface)} />
        ))}
      </g>
      <g className="stroke-border" strokeWidth={frame.gridStroke}>
        {roomGrid(room).map((segment) => {
          const from = project(segment.from);
          const to = project(segment.to);
          return <line key={segmentKey(segment)} x1={from.px} y1={from.py} x2={to.px} y2={to.py} />;
        })}
      </g>
      {ordered.map(({ placement }) => (
        <AppBox
          key={placement.app.ordinal}
          placement={placement}
          emphasis={emphasisFor({ ordinal: placement.app.ordinal, highlighted })}
          stroke={frame.boxStroke}
        />
      ))}
      <g className="fill-muted-foreground" fontSize={frame.fontSize} textAnchor="middle">
        {axisLabels({ room, gap: frame.titleGap }).map((label) => (
          <text
            key={label.axisKey}
            x={label.at.px}
            y={label.at.py}
            dominantBaseline="middle"
            transform={`rotate(${label.rotate} ${label.at.px} ${label.at.py})`}
          >
            {label.text}
          </text>
        ))}
      </g>
    </svg>
  );
}
