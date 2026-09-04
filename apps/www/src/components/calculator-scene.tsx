import { useEffect, useRef, useState } from 'react';
import { type AppSpec, AXES, type AxisKey } from '#lib/calculator.ts';

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

const PAD_LEFT_PX = 104;
const PAD_RIGHT_PX = 112;
const PAD_TOP_PX = 24;
const PAD_BOTTOM_PX = 84;

// Every title clears its own tick labels, which are as wide as the unit they carry.
const TICK_GAP_PX = 15;
const VCPU_TITLE_GAP_PX = 52;
const VOLUME_TITLE_GAP_PX = 78;
const MEMORY_TICK_GAP_PX = 12;
const MEMORY_TITLE_GAP_PX = 74;

const TICK_FONT_PX = 10.5;
const TITLE_FONT_PX = 11;

const CHART: Vec3 = {
  x: AXES.vcpu.steps.length,
  y: AXES.memory.steps.length,
  z: AXES.volume.steps.length,
};

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

const CHART_CORNERS: Vec3[] = [0, CHART.x].flatMap((x) =>
  [0, CHART.y].flatMap((y) => [0, CHART.z].map((z) => ({ x, y, z }))),
);
const PROJECTED_CORNERS = CHART_CORNERS.map(project);

const VIEW_MIN_X = Math.min(...PROJECTED_CORNERS.map((corner) => corner.px)) - PAD_LEFT_PX;
const VIEW_MAX_X = Math.max(...PROJECTED_CORNERS.map((corner) => corner.px)) + PAD_RIGHT_PX;
const VIEW_MIN_Y = Math.min(...PROJECTED_CORNERS.map((corner) => corner.py)) - PAD_TOP_PX;
const VIEW_MAX_Y = Math.max(...PROJECTED_CORNERS.map((corner) => corner.py)) + PAD_BOTTOM_PX;
const VIEW_BOX = `${VIEW_MIN_X} ${VIEW_MIN_Y} ${VIEW_MAX_X - VIEW_MIN_X} ${VIEW_MAX_Y - VIEW_MIN_Y}`;

const FLOOR: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: CHART.x, y: 0, z: 0 },
  { x: CHART.x, y: 0, z: CHART.z },
  { x: 0, y: 0, z: CHART.z },
];
const WALL_BEHIND_VCPU: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: CHART.y, z: 0 },
  { x: 0, y: CHART.y, z: CHART.z },
  { x: 0, y: 0, z: CHART.z },
];
const WALL_BEHIND_VOLUME: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: CHART.y, z: 0 },
  { x: CHART.x, y: CHART.y, z: 0 },
  { x: CHART.x, y: 0, z: 0 },
];

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

function gridSegments(): Segment[] {
  const xs = ticksUpTo(CHART.x);
  const ys = ticksUpTo(CHART.y);
  const zs = ticksUpTo(CHART.z);
  return withoutSharedEdges([
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: 0, z: CHART.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: CHART.x, y: 0, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: 0, y, z: CHART.z } })),
    ...zs.map((z) => ({ from: { x: 0, y: 0, z }, to: { x: 0, y: CHART.y, z } })),
    ...ys.map((y) => ({ from: { x: 0, y, z: 0 }, to: { x: CHART.x, y, z: 0 } })),
    ...xs.map((x) => ({ from: { x, y: 0, z: 0 }, to: { x, y: CHART.y, z: 0 } })),
  ]);
}

const GRID_SEGMENTS = gridSegments();

function offsetBy({ point, by }: { point: Point; by: Point }): Point {
  return { px: point.px + by.px, py: point.py + by.py };
}

function scaled({ direction, by }: { direction: Point; by: number }): Point {
  return { px: direction.px * by, py: direction.py * by };
}

// A label sits on the outward normal of the edge it belongs to, so it clears the chart at the
// same distance whatever the isometric skew does to that edge on screen.
const VCPU_NORMAL: Point = { px: -EDGE_SIN, py: EDGE_COS };
const VOLUME_NORMAL: Point = { px: EDGE_SIN, py: EDGE_COS };
const MEMORY_NORMAL: Point = { px: -1, py: 0 };

function alongVcpu(tick: number): Vec3 {
  return { x: tick, y: 0, z: CHART.z };
}

function alongVolume(tick: number): Vec3 {
  return { x: CHART.x, y: 0, z: tick };
}

function alongMemory(tick: number): Vec3 {
  return { x: 0, y: tick, z: CHART.z };
}

type SceneAxis = {
  axisKey: AxisKey;
  anchor: 'start' | 'end';
  tickOffset: Point;
  titleOffset: Point;
  titleRotateDeg: number;
  at: (tick: number) => Vec3;
};

const SCENE_AXES: SceneAxis[] = [
  {
    axisKey: 'vcpu',
    anchor: 'end',
    tickOffset: scaled({ direction: VCPU_NORMAL, by: TICK_GAP_PX }),
    titleOffset: scaled({ direction: VCPU_NORMAL, by: VCPU_TITLE_GAP_PX }),
    titleRotateDeg: EDGE_ANGLE_DEG,
    at: alongVcpu,
  },
  {
    axisKey: 'volume',
    anchor: 'start',
    tickOffset: scaled({ direction: VOLUME_NORMAL, by: TICK_GAP_PX }),
    titleOffset: scaled({ direction: VOLUME_NORMAL, by: VOLUME_TITLE_GAP_PX }),
    titleRotateDeg: -EDGE_ANGLE_DEG,
    at: alongVolume,
  },
  {
    axisKey: 'memory',
    anchor: 'end',
    tickOffset: scaled({ direction: MEMORY_NORMAL, by: MEMORY_TICK_GAP_PX }),
    titleOffset: scaled({ direction: MEMORY_NORMAL, by: MEMORY_TITLE_GAP_PX }),
    titleRotateDeg: -RIGHT_ANGLE_DEG,
    at: alongMemory,
  },
];

type TickLabel = { key: string; at: Point; text: string; anchor: 'start' | 'end' };

const TICK_LABELS: TickLabel[] = SCENE_AXES.flatMap((axis) =>
  [...AXES[axis.axisKey].steps.entries()].map(([step, value]) => ({
    key: `${axis.axisKey}-${value}`,
    at: offsetBy({ point: project(axis.at(step + 1)), by: axis.tickOffset }),
    text: AXES[axis.axisKey].format(value),
    anchor: axis.anchor,
  })),
);

type AxisTitle = { key: string; at: Point; text: string; rotate: number };

const AXIS_TITLES: AxisTitle[] = SCENE_AXES.map((axis) => ({
  key: axis.axisKey,
  at: offsetBy({
    point: project(axis.at(AXES[axis.axisKey].steps.length * HALF)),
    by: axis.titleOffset,
  }),
  text: AXES[axis.axisKey].name,
  rotate: axis.titleRotateDeg,
}));

const FACE_TOP_FILL = 'color-mix(in oklch, var(--primary), white 26%)';
const FACE_RIGHT_FILL = 'var(--primary)';
const FACE_LEFT_FILL = 'color-mix(in oklch, var(--primary), black 22%)';

type Face = { id: string; fill: string; vertices: Vec3[] };

function boxFaces(size: Vec3): Face[] {
  const { x, y, z } = size;
  return [
    {
      id: 'top',
      fill: FACE_TOP_FILL,
      vertices: [
        { x: 0, y, z: 0 },
        { x, y, z: 0 },
        { x, y, z },
        { x: 0, y, z },
      ],
    },
    {
      id: 'right',
      fill: FACE_RIGHT_FILL,
      vertices: [
        { x, y: 0, z: 0 },
        { x, y, z: 0 },
        { x, y, z },
        { x, y: 0, z },
      ],
    },
    {
      id: 'left',
      fill: FACE_LEFT_FILL,
      vertices: [
        { x: 0, y: 0, z },
        { x: 0, y, z },
        { x, y, z },
        { x, y: 0, z },
      ],
    },
  ];
}

function extentsOf(app: AppSpec): Vec3 {
  return { x: app.steps.vcpu + 1, y: app.steps.memory + 1, z: app.steps.volume + 1 };
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

// SVG geometry cannot be transitioned in CSS, so the box grows one frame at a time instead.
function useEasedExtents(target: Vec3): Vec3 {
  const { x, y, z } = target;
  const [extents, setExtents] = useState(target);
  const latest = useRef(target);

  useEffect(() => {
    const to = { x, y, z };
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      latest.current = to;
      setExtents(to);
      return;
    }

    let frame = 0;
    function step() {
      const next = easeToward({ from: latest.current, to });
      const settled = isSettled({ from: next, to });
      latest.current = settled ? to : next;
      setExtents(latest.current);
      if (!settled) {
        frame = requestAnimationFrame(step);
      }
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [x, y, z]);

  return extents;
}

const NEUTRAL_FILL_OPACITY = 0.34;
const NEUTRAL_STROKE_OPACITY = 0.6;
const ACTIVE_FILL_OPACITY = 0.72;
const ACTIVE_STROKE_OPACITY = 1;
const DIMMED_FILL_OPACITY = 0.1;
const DIMMED_STROKE_OPACITY = 0.22;

const BOX_STROKE_PX = 1.25;
const GRID_STROKE_PX = 1;

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

function AppBox({ app, emphasis }: { app: AppSpec; emphasis: Emphasis }) {
  const extents = useEasedExtents(extentsOf(app));
  const faces = boxFaces(extents);
  return (
    <g className="transition-opacity duration-200">
      <g fillOpacity={FILL_OPACITY[emphasis]}>
        {faces.map((face) => (
          <polygon key={face.id} points={polygonPoints(face.vertices)} fill={face.fill} />
        ))}
      </g>
      <g
        fill="none"
        stroke="var(--primary)"
        strokeOpacity={STROKE_OPACITY[emphasis]}
        strokeWidth={BOX_STROKE_PX}
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

function sizeOf(app: AppSpec): number {
  const { x, y, z } = extentsOf(app);
  return x + y + z;
}

// A box grows from the far corner, so the bigger one is the one nearer the eye — painting in
// ascending size is what makes it hide the smaller boxes it encloses.
// biome-ignore lint/complexity/useMaxParams: a comparator compares two boxes
function bySizeAscending(a: AppSpec, b: AppSpec): number {
  return sizeOf(a) - sizeOf(b);
}

export function CalculatorScene({
  apps,
  highlightedId,
}: {
  apps: AppSpec[];
  highlightedId: string | null;
}) {
  return (
    <svg
      viewBox={VIEW_BOX}
      aria-hidden="true"
      className="h-auto w-full select-none"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="fill-muted/60">
        <polygon points={polygonPoints(FLOOR)} />
        <polygon points={polygonPoints(WALL_BEHIND_VCPU)} />
        <polygon points={polygonPoints(WALL_BEHIND_VOLUME)} />
      </g>
      <g className="stroke-border" strokeWidth={GRID_STROKE_PX}>
        {GRID_SEGMENTS.map((segment) => {
          const from = project(segment.from);
          const to = project(segment.to);
          return <line key={segmentKey(segment)} x1={from.px} y1={from.py} x2={to.px} y2={to.py} />;
        })}
      </g>
      <g className="fill-muted-foreground" fontSize={TICK_FONT_PX} dominantBaseline="middle">
        {TICK_LABELS.map((label) => (
          <text key={label.key} x={label.at.px} y={label.at.py} textAnchor={label.anchor}>
            {label.text}
          </text>
        ))}
      </g>
      <g className="fill-primary" fontSize={TITLE_FONT_PX} textAnchor="middle">
        {AXIS_TITLES.map((title) => (
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
      {[...apps].sort(bySizeAscending).map((app) => (
        <AppBox key={app.id} app={app} emphasis={emphasisFor({ id: app.id, highlightedId })} />
      ))}
    </svg>
  );
}
