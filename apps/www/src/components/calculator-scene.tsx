import { useEffect, useRef, useState } from 'react';
import { type AppSpec, AXES, type AxisKey } from '#lib/calculator.ts';

type Vec3 = { x: number; y: number; z: number };
type Point = { px: number; py: number };
type Segment = { from: Vec3; to: Vec3 };
type Floor = { x: number; z: number };

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
const PAD_RATIO = 0.09;
const FONT_RATIO = 0.019;
const TITLE_GAP_RATIO = 0.028;
const GRID_STROKE_RATIO = 0.0013;
const BOX_STROKE_RATIO = 0.0018;

/** Held fixed so the drawing keeps its shape as the room grows under it. */
const VIEW_ASPECT = 1.35;

const ROOM_HEIGHT = AXES.memory.steps.length;
const MAX_BOX_WIDTH = AXES.vcpu.steps.length;
const MAX_BOX_DEPTH = AXES.volume.steps.length;

const BOX_GAP = 1;
const ROOM_MARGIN = 1;

/** Wide enough that boxes stand beside each other before the room grows a second row. */
const ROW_TARGET_WIDTH = 11;

/** A room is never tighter than a single box grown all the way, so one box is never the room. */
const MIN_FLOOR: Floor = { x: MAX_BOX_WIDTH + ROOM_MARGIN, z: MAX_BOX_DEPTH + ROOM_MARGIN };

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
type Room = { placements: Placement[]; floor: Floor };

// biome-ignore lint/complexity/useMaxParams: a comparator compares two boxes
function byBiggestFirst(a: AppSpec, b: AppSpec): number {
  const left = extentsOf(a);
  const right = extentsOf(b);
  return right.y - left.y || right.z - left.z || right.x - left.x;
}

// Boxes stand on the floor in rows, biggest first, so the tall ones take the far corner and
// nothing behind is ever swallowed by what is in front of it.
function packRoom(apps: AppSpec[]): Room {
  const placements: Placement[] = [];
  let rowX = 0;
  let rowZ = 0;
  let rowDepth = 0;
  let widest = 0;

  for (const app of [...apps].sort(byBiggestFirst)) {
    const size = extentsOf(app);
    if (rowX > 0 && rowX + size.x > ROW_TARGET_WIDTH) {
      rowZ += rowDepth + BOX_GAP;
      rowX = 0;
      rowDepth = 0;
    }
    placements.push({ app, origin: { x: rowX, y: 0, z: rowZ }, size });
    rowX += size.x + BOX_GAP;
    rowDepth = Math.max(rowDepth, size.z);
    widest = Math.max(widest, rowX - BOX_GAP);
  }

  return {
    placements,
    floor: {
      x: Math.max(MIN_FLOOR.x, widest + ROOM_MARGIN),
      z: Math.max(MIN_FLOOR.z, rowZ + rowDepth + ROOM_MARGIN),
    },
  };
}

// biome-ignore lint/complexity/useMaxParams: a comparator compares two placements
function byDepth(a: Placement, b: Placement): number {
  return a.origin.x + a.origin.z - (b.origin.x + b.origin.z);
}

function floorCorners(floor: Floor): Vec3[] {
  return [
    { x: 0, y: 0, z: 0 },
    { x: floor.x, y: 0, z: 0 },
    { x: floor.x, y: 0, z: floor.z },
    { x: 0, y: 0, z: floor.z },
  ];
}

function wallBehindVcpu(floor: Floor): Vec3[] {
  return [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: ROOM_HEIGHT, z: 0 },
    { x: 0, y: ROOM_HEIGHT, z: floor.z },
    { x: 0, y: 0, z: floor.z },
  ];
}

function wallBehindVolume(floor: Floor): Vec3[] {
  return [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: ROOM_HEIGHT, z: 0 },
    { x: floor.x, y: ROOM_HEIGHT, z: 0 },
    { x: floor.x, y: 0, z: 0 },
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

function gridSegments(floor: Floor): Segment[] {
  const xs = ticksUpTo(floor.x);
  const ys = ticksUpTo(ROOM_HEIGHT);
  const zs = ticksUpTo(floor.z);
  return withoutSharedEdges([
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: 0, z: floor.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: floor.x, y: 0, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: 0, y, z: floor.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: 0, y: ROOM_HEIGHT, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: floor.x, y, z: 0 } })),
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: ROOM_HEIGHT, z: 0 } })),
  ]);
}

function offsetBy({ point, by }: { point: Point; by: Point }): Point {
  return { px: point.px + by.px, py: point.py + by.py };
}

function scaled({ direction, by }: { direction: Point; by: number }): Point {
  return { px: direction.px * by, py: direction.py * by };
}

// A title sits on the outward normal of the edge it names, so it clears the room at the same
// distance whatever the isometric skew does to that edge on screen.
const VCPU_NORMAL: Point = { px: -EDGE_SIN, py: EDGE_COS };
const VOLUME_NORMAL: Point = { px: EDGE_SIN, py: EDGE_COS };
const MEMORY_NORMAL: Point = { px: -1, py: 0 };

type SceneAxis = {
  axisKey: AxisKey;
  normal: Point;
  rotateDeg: number;
  midpoint: (floor: Floor) => Vec3;
};

function alongVcpu(floor: Floor): Vec3 {
  return { x: floor.x * HALF, y: 0, z: floor.z };
}

function alongVolume(floor: Floor): Vec3 {
  return { x: floor.x, y: 0, z: floor.z * HALF };
}

function alongMemory(floor: Floor): Vec3 {
  return { x: 0, y: ROOM_HEIGHT * HALF, z: floor.z };
}

const SCENE_AXES: SceneAxis[] = [
  { axisKey: 'vcpu', normal: VCPU_NORMAL, rotateDeg: EDGE_ANGLE_DEG, midpoint: alongVcpu },
  { axisKey: 'volume', normal: VOLUME_NORMAL, rotateDeg: -EDGE_ANGLE_DEG, midpoint: alongVolume },
  { axisKey: 'memory', normal: MEMORY_NORMAL, rotateDeg: -RIGHT_ANGLE_DEG, midpoint: alongMemory },
];

type AxisTitle = { key: string; at: Point; text: string; rotate: number };

function axisTitles({ floor, gap }: { floor: Floor; gap: number }): AxisTitle[] {
  return SCENE_AXES.map((axis) => ({
    key: axis.axisKey,
    at: offsetBy({
      point: project(axis.midpoint(floor)),
      by: scaled({ direction: axis.normal, by: gap }),
    }),
    text: AXES[axis.axisKey].name,
    rotate: axis.rotateDeg,
  }));
}

type Frame = {
  viewBox: string;
  fontSize: number;
  titleGap: number;
  gridStroke: number;
  boxStroke: number;
};

function frameFor(floor: Floor): Frame {
  const corners = [0, floor.x].flatMap((x) =>
    [0, ROOM_HEIGHT].flatMap((y) => [0, floor.z].map((z) => project({ x, y, z }))),
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
  const left = (minX + maxX) * HALF - width * HALF;
  const top = (minY + maxY) * HALF - height * HALF;

  return {
    viewBox: `${left} ${top} ${width} ${height}`,
    fontSize: width * FONT_RATIO,
    titleGap: width * TITLE_GAP_RATIO,
    gridStroke: width * GRID_STROKE_RATIO,
    boxStroke: width * BOX_STROKE_RATIO,
  };
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

const NEUTRAL_FILL_OPACITY = 0.78;
const NEUTRAL_STROKE_OPACITY = 0.9;
const ACTIVE_FILL_OPACITY = 1;
const ACTIVE_STROKE_OPACITY = 1;
const DIMMED_FILL_OPACITY = 0.28;
const DIMMED_STROKE_OPACITY = 0.35;

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
  id,
  highlightedId,
}: {
  id: string;
  highlightedId: string | null;
}): Emphasis {
  if (highlightedId === null) {
    return 'neutral';
  }
  return highlightedId === id ? 'active' : 'dimmed';
}

export function CalculatorScene({
  apps,
  highlightedId,
}: {
  apps: AppSpec[];
  highlightedId: string | null;
}) {
  const { placements, floor } = packRoom(apps);
  const frame = frameFor(floor);

  return (
    <svg
      viewBox={frame.viewBox}
      aria-hidden="true"
      className="h-auto w-full select-none"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="fill-muted/60">
        <polygon points={polygonPoints(floorCorners(floor))} />
        <polygon points={polygonPoints(wallBehindVcpu(floor))} />
        <polygon points={polygonPoints(wallBehindVolume(floor))} />
      </g>
      <g className="stroke-border" strokeWidth={frame.gridStroke}>
        {gridSegments(floor).map((segment) => {
          const from = project(segment.from);
          const to = project(segment.to);
          return <line key={segmentKey(segment)} x1={from.px} y1={from.py} x2={to.px} y2={to.py} />;
        })}
      </g>
      <g className="fill-muted-foreground" fontSize={frame.fontSize} textAnchor="middle">
        {axisTitles({ floor, gap: frame.titleGap }).map((title) => (
          <text
            key={title.key}
            x={title.at.px}
            y={title.at.py}
            dominantBaseline="middle"
            transform={`rotate(${title.rotate} ${title.at.px} ${title.at.py})`}
          >
            {title.text}
          </text>
        ))}
      </g>
      {[...placements].sort(byDepth).map((placement) => (
        <AppBox
          key={placement.app.id}
          placement={placement}
          emphasis={emphasisFor({ id: placement.app.id, highlightedId })}
          stroke={frame.boxStroke}
        />
      ))}
    </svg>
  );
}
