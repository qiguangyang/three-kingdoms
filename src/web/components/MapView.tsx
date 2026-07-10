import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GRID_SCALE, MAP_HEIGHT, MAP_WIDTH } from '../../engine/constants.js';
import type { City, GameState } from '../../engine/types.js';
import {
  COASTLINE_PATH,
  FORESTS,
  GREAT_WALL_PATH,
  LAKES,
  MOUNTAINS,
  PROVINCE_LABELS,
  RIVERS,
  SEA_LABELS,
  SEA_PATH,
  type MountainRange,
} from '../../data/map/geography.js';
import { FACTION_GLYPH, factionColor } from '../theme.js';
import { pickName } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

export interface MapViewProps {
  game: GameState;
  selectedCityId: string | null;
  onSelectCity: (cityId: string | null) => void;
  // When set, the named city renders with a pulsing red ring to indicate
  // an in-progress battle. Driven by MainScreen during the post-attack
  // animation OR derived from siege ops in game.pendingOps.
  battleCityId?: string | null;
  // Legacy: single march line for the one-shot battle animation. Still
  // honored. Persistent-game marches use `pendingMarches` instead.
  marchLine?: {
    fromCityId: string;
    toCityId: string;
    progress: number;
    faded: boolean;
  } | null;
  // Live overlay of all march ops currently in flight, derived from
  // game.pendingOps. Each renders as a moving arrow whose progress
  // advances with the remaining days. Intent decides the color tone
  // (attack = red, reinforce = teal).
  pendingMarches?: Array<{
    fromCityId: string;
    toCityId: string;
    progress: number;
    intent: 'attack' | 'reinforce';
  }>;
  // Cities currently under siege (engine pendingOps of kind 'siege').
  // Each gets a sustained pulse + a siege banner above its marker.
  siegeCityIds?: string[];
  // Internal-affairs ops in progress — develop/commerce/govern/etc.
  // Each city gets a colored arc that fills as the op nears completion.
  // The color encodes the kind so a glance tells you what's underway.
  internalOps?: Array<{
    cityId: string;
    kind: 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit';
    progress: number; // 0..1
  }>;
}

const INTERNAL_OP_COLOR: Record<string, string> = {
  develop: '#4d7c3a',  // 农业绿
  commerce: '#b8861b', // 招商金
  govern: '#9b3a3a',   // 治理朱
  patrol: '#5c6975',   // 出巡石
  search: '#6b3d8a',   // 搜寻紫
  recruit: '#8a5a2a',  // 征兵铜
};

// Pixels per SCALED grid unit. Coordinates (city.pos + all geography) are now
// multiplied by GRID_SCALE, so we divide the old 32 px/cell by GRID_SCALE to
// keep the map at the same on-screen extent (MAP_PX_W stays 3200).
const CELL = 32 / GRID_SCALE;
// Pixels per AUTHORED base cell (= 32). Feature sizes (marker radius, fonts,
// stroke widths, half-cell offsets) were tuned against the base grid; scaling
// a base-unit quantity by GRID_SCALE lifts it into scaled-unit space, and
// UNIT is that quantity already resolved to pixels (CELL * GRID_SCALE).
const UNIT = CELL * GRID_SCALE;
// Half a base cell expressed in scaled units — the center offset that puts a
// city glyph in the middle of its cell rather than on the grid line.
const HALF_CELL = 0.5 * GRID_SCALE;
const MAP_PX_W = MAP_WIDTH * CELL;
const MAP_PX_H = MAP_HEIGHT * CELL;

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.18;

interface Viewbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MapView: React.FC<MapViewProps> = ({
  game,
  selectedCityId,
  onSelectCity,
  battleCityId,
  marchLine,
  pendingMarches,
  siegeCityIds,
  internalOps,
}) => {
  // Re-render on locale change so labels update.
  useSession(selectLocale);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1000, h: 560 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Center the view on the central plains (Luoyang, base cell 30,17) by
  // default. The viewbox is in SVG pixels; Luoyang now lives at the scaled
  // coord 30*GRID_SCALE, so its pixel center is 30*GRID_SCALE*CELL.
  const [viewbox, setViewbox] = useState<Viewbox>(() => ({
    x: 30 * GRID_SCALE * CELL - 500,
    y: 17 * GRID_SCALE * CELL - 280,
    w: 1000,
    h: 560,
  }));

  // Keep the viewBox aspect ratio matched to the container. We
  // deliberately preserve whatever v.w the user has zoomed to (don't
  // overwrite it with size.w — that would cancel the zoom on every
  // layout shift) and just recompute v.h from the container aspect.
  //
  // Guard against transient 0×0 container sizes (modal open/close,
  // flex collapse, etc.) — propagating a 0 into the viewBox makes the
  // SVG render nothing, and because of how React batches setState the
  // viewBox can get stuck there permanently. When size is degenerate
  // we just skip the update; the next non-zero ResizeObserver fire
  // will recover.
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    setViewbox((v) => {
      const safeW = v.w > 0 ? v.w : size.w;
      return { ...v, w: safeW, h: safeW * (size.h / size.w) };
    });
  }, [size.w, size.h]);

  // ----- pan + zoom -----
  const isPanning = useRef(false);
  const panStart = useRef<{ x: number; y: number; vbX: number; vbY: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest('.map-city')) return;
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, vbX: viewbox.x, vbY: viewbox.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [viewbox.x, viewbox.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPanning.current || !panStart.current) return;
      if (size.w <= 0) return; // can't compute scale; ignore pan
      // Snapshot the drag anchor INTO local variables before kicking off
      // setViewbox. The state-updater function may run later (and twice
      // under StrictMode), at which point panStart.current may already
      // be null because pointerup fired in between — dereferencing it
      // there would throw "Cannot read 'vbX' of null".
      const { x: startX, y: startY, vbX, vbY } = panStart.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const scale = viewbox.w / size.w;
      setViewbox((v) => ({
        ...v,
        x: safeClamp(vbX - dx * scale, -200, MAP_PX_W - v.w + 200),
        y: safeClamp(vbY - dy * scale, -200, MAP_PX_H - v.h + 200),
      }));
    },
    [size.w, viewbox.w],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isPanning.current = false;
    panStart.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      // Guard against degenerate states that would NaN out the viewBox
      // and leave the SVG blank: zero container or zero viewBox.
      if (size.w <= 0 || size.h <= 0) return;
      if (viewbox.w <= 0 || viewbox.h <= 0) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const cx = ((e.clientX - rect.left) / rect.width) * viewbox.w + viewbox.x;
      const cy = ((e.clientY - rect.top) / rect.height) * viewbox.h + viewbox.y;
      const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      const newW = safeClamp(viewbox.w * factor, size.w / MAX_ZOOM, size.w / MIN_ZOOM);
      const newH = newW * (size.h / size.w);
      setViewbox({
        x: cx - ((cx - viewbox.x) * newW) / viewbox.w,
        y: cy - ((cy - viewbox.y) * newH) / viewbox.h,
        w: newW,
        h: newH,
      });
    },
    [size.h, size.w, viewbox],
  );

  // Forest dot positions are deterministic given the patch dimensions.
  const forestDots = useMemo(buildForestDots, []);

  // Defensive: ensure the viewBox numbers we hand to the SVG renderer
  // are always finite, positive, and non-zero. If anything degenerates
  // (NaN from a fast pinch-zoom, 0 from a layout collapse) we fall
  // back to a sensible default so the SVG keeps drawing instead of
  // going blank.
  const safeViewbox = {
    x: Number.isFinite(viewbox.x) ? viewbox.x : 0,
    y: Number.isFinite(viewbox.y) ? viewbox.y : 0,
    w: Number.isFinite(viewbox.w) && viewbox.w > 0 ? viewbox.w : Math.max(100, size.w || 1000),
    h: Number.isFinite(viewbox.h) && viewbox.h > 0 ? viewbox.h : Math.max(100, size.h || 560),
  };
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg
        className="map-svg"
        data-testid="svg-map"
        viewBox={`${safeViewbox.x} ${safeViewbox.y} ${safeViewbox.w} ${safeViewbox.h}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="paper" patternUnits="userSpaceOnUse" width={UNIT * 6} height={UNIT * 6}>
            <rect width={UNIT * 6} height={UNIT * 6} fill="#f1e3bf" />
            <rect
              width={UNIT * 6}
              height={UNIT * 6}
              fill="url(#paperNoise)"
              opacity="0.45"
            />
          </pattern>
          <filter id="paperNoise" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3" />
            <feColorMatrix values="0 0 0 0 0.50  0 0 0 0 0.40  0 0 0 0 0.22  0 0 0 0.30 0" />
          </filter>
          <pattern id="seaPattern" patternUnits="userSpaceOnUse" width={UNIT * 4} height={UNIT * 4}>
            <rect width={UNIT * 4} height={UNIT * 4} fill="#c7dde7" />
            <path
              d={`M 0 ${UNIT * 2} Q ${UNIT} ${UNIT * 1.6} ${UNIT * 2} ${UNIT * 2} T ${UNIT * 4} ${UNIT * 2}`}
              fill="none"
              stroke="#94b8c8"
              strokeWidth="1.2"
              opacity="0.6"
            />
            <path
              d={`M 0 ${UNIT * 3.4} Q ${UNIT} ${UNIT * 3.0} ${UNIT * 2} ${UNIT * 3.4} T ${UNIT * 4} ${UNIT * 3.4}`}
              fill="none"
              stroke="#94b8c8"
              strokeWidth="1.2"
              opacity="0.45"
            />
          </pattern>
          <pattern id="lakePattern" patternUnits="userSpaceOnUse" width={UNIT * 2} height={UNIT * 2}>
            <rect width={UNIT * 2} height={UNIT * 2} fill="#a9c8d6" />
            <path
              d={`M 0 ${UNIT} Q ${UNIT / 2} ${UNIT * 0.8} ${UNIT} ${UNIT} T ${UNIT * 2} ${UNIT}`}
              fill="none"
              stroke="#7ea4b6"
              strokeWidth="1"
              opacity="0.7"
            />
          </pattern>
          {/* Single reusable tree glyph */}
          <g id="tree">
            <path d="M 0 0 L 4 0 L 2 -7 Z" fill="#566c4b" />
            <path d="M -1 -1 L 5 -1 L 2 -10 Z" fill="#6b8156" />
            <rect x="1.6" y="0" width="0.8" height="2" fill="#473321" />
          </g>
        </defs>

        {/* ============ Layer 0: parchment background ============ */}
        <rect
          x={-300}
          y={-300}
          width={MAP_PX_W + 600}
          height={MAP_PX_H + 600}
          fill="url(#paper)"
        />

        {/* ============ Layer 1: sea + coastline ============ */}
        <g transform={`scale(${CELL})`}>
          <path d={SEA_PATH} fill="url(#seaPattern)" />
          <path
            d={COASTLINE_PATH}
            fill="none"
            stroke="#7d5a3a"
            strokeWidth={0.06 * GRID_SCALE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* ============ Layer 2: large province labels (behind everything else) ============ */}
        <g transform={`scale(${CELL})`} pointerEvents="none">
          {PROVINCE_LABELS.map((p) => (
            <text
              key={p.text.zh}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'Noto Serif SC', serif"
              fontSize={(p.size ?? 1) * 1.4 * GRID_SCALE}
              fontWeight={700}
              letterSpacing={(p.size ?? 1) * 0.3 * GRID_SCALE}
              fill="#8a7437"
              opacity={0.16}
            >
              {pickName(p.text)}
            </text>
          ))}
        </g>

        {/* ============ Layer 3: mountain ridges (back row, lighter) ============ */}
        <g transform={`scale(${CELL})`}>
          {MOUNTAINS.map((m) => (
            <MountainPath
              key={`${m.id}-shadow`}
              m={m}
              offsetY={0.6 * GRID_SCALE}
              fill="#a99476"
              opacity={0.45}
            />
          ))}
          {MOUNTAINS.map((m) => (
            <MountainPath key={m.id} m={m} fill="#7a6648" opacity={0.85} />
          ))}
          {MOUNTAINS.map((m) => (
            <MountainPath
              key={`${m.id}-highlight`}
              m={m}
              offsetY={-0.2 * GRID_SCALE}
              fill="none"
              stroke="#3d3324"
              strokeWidth={0.04 * GRID_SCALE}
              opacity={0.45}
            />
          ))}
        </g>

        {/* ============ Layer 4: lakes ============ */}
        <g transform={`scale(${CELL})`}>
          {LAKES.map((lake) => (
            <g key={lake.id}>
              <polygon
                points={lake.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="url(#lakePattern)"
                stroke="#5a85a0"
                strokeWidth={0.045 * GRID_SCALE}
                strokeOpacity={0.6}
              />
              <text
                x={lake.labelAt[0]}
                y={lake.labelAt[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="'Noto Serif SC', serif"
                fontSize={0.6 * GRID_SCALE}
                fontStyle="italic"
                fill="#2a4a5a"
                pointerEvents="none"
              >
                {pickName(lake.name)}
              </text>
            </g>
          ))}
        </g>

        {/* ============ Layer 5: rivers (two-stroke for depth) ============ */}
        <g transform={`scale(${CELL})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* dark outer stroke for shadow */}
          {RIVERS.map((r) => (
            <path
              key={`${r.id}-shadow`}
              d={r.path}
              stroke="#3a5567"
              strokeWidth={(r.id === 'huanghe' || r.id === 'changjiang' ? 0.42 : 0.3) * GRID_SCALE}
              opacity={0.55}
            />
          ))}
          {/* main blue stroke */}
          {RIVERS.map((r) => (
            <path
              key={r.id}
              d={r.path}
              stroke={r.id === 'huanghe' ? '#a47a3c' : '#5083a6'}
              strokeWidth={(r.id === 'huanghe' || r.id === 'changjiang' ? 0.32 : 0.22) * GRID_SCALE}
              opacity={0.9}
            />
          ))}
          {/* river names */}
          {RIVERS.map((r) => {
            const mid = midpointOfPath(r.path);
            if (!mid) return null;
            return (
              <text
                key={`${r.id}-label`}
                x={mid.x}
                y={mid.y - 0.5 * GRID_SCALE}
                textAnchor="middle"
                fontFamily="'Noto Serif SC', serif"
                fontStyle="italic"
                fontSize={0.55 * GRID_SCALE}
                fill="#2a3f4f"
                opacity={0.8}
                pointerEvents="none"
              >
                {pickName(r.name)}
              </text>
            );
          })}
        </g>

        {/* ============ Layer 6: forests ============ */}
        <g transform={`scale(${CELL})`}>
          {forestDots.map((d, i) => (
            <use
              key={i}
              href="#tree"
              transform={`translate(${d.x} ${d.y}) scale(${d.s * 0.04 * GRID_SCALE})`}
            />
          ))}
        </g>

        {/* ============ Layer 6.5: Great Wall ============ */}
        <g transform={`scale(${CELL})`} fill="none" pointerEvents="none">
          <path
            d={GREAT_WALL_PATH}
            stroke="#6a3a1a"
            strokeWidth={0.12 * GRID_SCALE}
            strokeDasharray={`${0.6 * GRID_SCALE} ${0.25 * GRID_SCALE}`}
            strokeLinecap="round"
            opacity={0.85}
          />
          {/* Wall battlement ticks: a few short perpendiculars hinting at
              towers. The x anchors are base-cell coordinates, lifted into
              scaled space to stay on the (scaled) wall path. */}
          {[12, 24, 36, 48, 60, 72].map((x) => (
            <line
              key={x}
              x1={x * GRID_SCALE}
              y1={3.4 * GRID_SCALE}
              x2={x * GRID_SCALE}
              y2={5.4 * GRID_SCALE}
              stroke="#6a3a1a"
              strokeWidth={0.08 * GRID_SCALE}
              opacity={0.7}
            />
          ))}
          <text
            x={40 * GRID_SCALE}
            y={2.6 * GRID_SCALE}
            textAnchor="middle"
            fontFamily="'Noto Serif SC', serif"
            fontStyle="italic"
            fontSize={0.7 * GRID_SCALE}
            fill="#6a3a1a"
            opacity={0.85}
          >
            {pickName({ zh: '长城', en: 'Great Wall' })}
          </text>
        </g>

        {/* ============ Layer 7: sea labels ============ */}
        <g transform={`scale(${CELL})`} pointerEvents="none">
          {SEA_LABELS.map((p) => (
            <text
              key={p.text.zh}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'Noto Serif SC', serif"
              fontSize={(p.size ?? 1) * 0.9 * GRID_SCALE}
              fontWeight={500}
              letterSpacing={(p.size ?? 1) * 0.18 * GRID_SCALE}
              fill="#3f6a82"
              opacity={0.6}
            >
              {pickName(p.text)}
            </text>
          ))}
        </g>

        {/* ============ Layer 8: faction tints (radial halos) ============ */}
        <g transform={`scale(${CELL})`}>
          {Object.values(game.cities).map((city) => (
            <circle
              key={`tint-${city.id}`}
              cx={city.pos.x + HALF_CELL}
              cy={city.pos.y + HALF_CELL}
              r={2 * GRID_SCALE}
              fill={factionColor(city.factionId)}
              opacity={city.factionId ? 0.14 : 0.04}
            />
          ))}
        </g>

        {/* ============ Layer 8.5: march line ============ */}
        {marchLine && (
          <MarchLine
            game={game}
            fromCityId={marchLine.fromCityId}
            toCityId={marchLine.toCityId}
            progress={marchLine.progress}
            faded={marchLine.faded}
          />
        )}
        {/* Persistent-game in-flight marches. Each ticks 1/day; we
            visualize the army's current position as an arrow along the
            path. Reinforcements get a teal hue, attacks stay red. */}
        {pendingMarches?.map((m, i) => (
          <MarchLine
            key={`pending-${i}`}
            game={game}
            fromCityId={m.fromCityId}
            toCityId={m.toCityId}
            progress={m.progress}
            faded={false}
            tone={m.intent}
          />
        ))}

        {/* ============ Layer 9: cities ============ */}
        <g>
          {Object.values(game.cities).map((city) => {
            const underSiege = siegeCityIds?.includes(city.id) ?? false;
            const op = internalOps?.find((o) => o.cityId === city.id);
            return (
              <CityMarker
                key={city.id}
                city={city}
                selected={city.id === selectedCityId}
                isBattling={city.id === battleCityId || underSiege}
                internalOp={op}
                onClick={() => onSelectCity(city.id === selectedCityId ? null : city.id)}
              />
            );
          })}
        </g>

        {/* ============ Layer 10: compass rose ============ */}
        {size.w > 0 && size.h > 0 && safeViewbox.w > 0 && (
          <g
            transform={`translate(${size.w * 0.92 + safeViewbox.x} ${size.h * 0.08 + safeViewbox.y}) scale(${safeViewbox.w / size.w})`}
            opacity={0.6}
          >
            <CompassRose />
          </g>
        )}
      </svg>

      {/* Zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button
          className="btn btn-ghost px-2 py-1"
          aria-label="Zoom in"
          onClick={() => setViewbox((v) => zoomTo(v, size, 1 / ZOOM_STEP))}
        >
          +
        </button>
        <button
          className="btn btn-ghost px-2 py-1"
          aria-label="Zoom out"
          onClick={() => setViewbox((v) => zoomTo(v, size, ZOOM_STEP))}
        >
          −
        </button>
        <button
          className="btn btn-ghost px-2 py-1"
          aria-label="Reset"
          onClick={() =>
            setViewbox({
              x: 30 * GRID_SCALE * CELL - size.w / 2,
              y: 17 * GRID_SCALE * CELL - size.h / 2,
              w: size.w,
              h: size.h,
            })
          }
        >
          ◎
        </button>
      </div>
    </div>
  );
};

// --------------------------------------------------------- Mountain helper

const MountainPath: React.FC<{
  m: MountainRange;
  offsetY?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}> = ({ m, offsetY = 0, fill, stroke, strokeWidth, opacity }) => {
  // Build a polygon by joining the ridge points then closing along the
  // baseline. Each point shifts by offsetY so we can draw a "shadow" layer
  // slightly below the silhouette.
  const ridgePoints = m.ridge.map(([x, y]) => `${x},${y + offsetY}`);
  const first = m.ridge[0];
  const last = m.ridge[m.ridge.length - 1];
  if (!first || !last) return null;
  const polygon = [
    ...ridgePoints,
    `${last[0]},${m.baseline + offsetY}`,
    `${first[0]},${m.baseline + offsetY}`,
  ].join(' ');
  return (
    <polygon
      points={polygon}
      fill={fill ?? 'none'}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
};

// --------------------------------------------------------- City marker

interface CityMarkerProps {
  city: City;
  selected: boolean;
  isBattling?: boolean;
  // When set, draw a colored progress arc around the marker for an
  // in-progress internal-affairs op (develop/commerce/govern/...).
  internalOp?: {
    kind: 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit';
    progress: number;
  };
  onClick: () => void;
}

const CityMarker: React.FC<CityMarkerProps> = ({
  city,
  selected,
  isBattling,
  internalOp,
  onClick,
}) => {
  const cx = (city.pos.x + HALF_CELL) * CELL;
  const cy = (city.pos.y + HALF_CELL) * CELL;
  const glyph = city.factionId ? FACTION_GLYPH[city.factionId] ?? '·' : '·';
  const color = factionColor(city.factionId);
  const r = UNIT * 0.42;
  // Outer <g> owns the translate (positioning the marker on the map).
  // Inner <g> owns the className and receives the CSS hover transform
  // (scale). Splitting these prevents the SVG transform attribute from
  // being overridden by the CSS hover rule, which would otherwise cause
  // the marker to jump to (0,0) on hover and produce a flicker loop.
  // Progress arc: a colored ring that fills clockwise as the
  // internal-affairs op completes. Rendered behind the marker so the
  // city glyph stays legible. The track is a faint background ring;
  // the fill is the partial arc.
  const arcRadius = r * 1.55;
  const arcCircumference = 2 * Math.PI * arcRadius;
  const arcProgress = internalOp ? Math.max(0, Math.min(1, internalOp.progress)) : 0;
  const arcColor = internalOp ? INTERNAL_OP_COLOR[internalOp.kind] : null;

  return (
    <g transform={`translate(${cx} ${cy})`}>
      {internalOp && arcColor && (
        <g pointerEvents="none">
          {/* Background track */}
          <circle
            r={arcRadius}
            fill="none"
            stroke={arcColor}
            strokeWidth={2}
            strokeOpacity={0.18}
          />
          {/* Filled arc — start at 12 o'clock by rotating −90°. */}
          <circle
            r={arcRadius}
            fill="none"
            stroke={arcColor}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray={`${arcProgress * arcCircumference} ${arcCircumference}`}
            transform="rotate(-90)"
            style={{ transition: 'stroke-dasharray 220ms linear' }}
          />
          {/* Small kind glyph dot at 12 o'clock */}
          <circle cx={0} cy={-arcRadius} r={3} fill={arcColor} />
        </g>
      )}
      {isBattling && (
        <>
          <circle
            r={r * 1.8}
            fill="none"
            stroke="#b71c1c"
            strokeWidth={2.4}
            className="map-battle-pulse"
          />
          <circle
            r={r * 1.4}
            fill="none"
            stroke="#fb923c"
            strokeWidth={1.6}
            className="map-battle-pulse map-battle-pulse-inner"
          />
        </>
      )}
      <g
        className={`map-city${selected ? ' is-selected' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {selected && (
          <circle
            r={r * 1.35}
            fill="none"
            stroke="#b71c1c"
            strokeWidth={1.6}
            strokeDasharray="3 2"
          />
        )}
        <rect
          x={-r}
          y={-r}
          width={r * 2}
          height={r * 2}
          rx={2}
          fill={city.factionId ? color : '#efe1be'}
          stroke={city.factionId ? '#3d0404' : '#7d6e4f'}
          strokeWidth={1.6}
        />
        <text
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="'Noto Serif SC', serif"
          fontSize={r * 1.4}
          fontWeight={700}
          fill={city.factionId ? '#f8e8d2' : '#564a35'}
        >
          {glyph}
        </text>
        <text
          y={r * 2 + 4}
          textAnchor="middle"
          fontFamily="'Noto Serif SC', serif"
          fontSize={r * 1.0}
          fontWeight={500}
          fill="#2a2218"
          stroke="#f8f1de"
          strokeWidth={3.5}
          paintOrder="stroke"
        >
          {pickName(city.name)}
        </text>
      </g>
    </g>
  );
};

// --------------------------------------------------------- march line

interface MarchLineProps {
  game: GameState;
  fromCityId: string;
  toCityId: string;
  progress: number; // 0..1: how far the head has traveled toward the target
  faded: boolean;   // true after engagement starts: line stays but dimmed
  // Color tone. 'attack' (default) = sienna red. 'reinforce' = teal.
  tone?: 'attack' | 'reinforce';
}

const MarchLine: React.FC<MarchLineProps> = ({
  game,
  fromCityId,
  toCityId,
  progress,
  faded,
  tone = 'attack',
}) => {
  const from = game.cities[fromCityId];
  const to = game.cities[toCityId];
  if (!from || !to) return null;
  const x1 = (from.pos.x + HALF_CELL) * CELL;
  const y1 = (from.pos.y + HALF_CELL) * CELL;
  const x2 = (to.pos.x + HALF_CELL) * CELL;
  const y2 = (to.pos.y + HALF_CELL) * CELL;
  // Curve a bit so the arrow doesn't slice straight through other cities.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular offset for the control point of a quadratic curve.
  const nx = -dy / len;
  const ny = dx / len;
  const sag = Math.min(UNIT * 1.4, len * 0.2);
  const cx = mx + nx * sag;
  const cy = my + ny * sag;
  const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
  // Approximate path length for dashoffset interpolation. The quadratic
  // arc length is < straight + 2*sag; this overestimate is fine because
  // strokeDashoffset just controls visual reveal.
  const approxLen = Math.hypot(x2 - x1, y2 - y1) + sag * 2;
  // Reveal: at progress 0 the whole path is hidden, at 1 it's fully drawn.
  const dashOffset = approxLen * (1 - progress);

  // Arrowhead at the head's current position along the curve.
  const headT = Math.max(0, Math.min(1, progress));
  // Quadratic Bezier point at parameter t.
  const bx = (1 - headT) * (1 - headT) * x1 + 2 * (1 - headT) * headT * cx + headT * headT * x2;
  const by = (1 - headT) * (1 - headT) * y1 + 2 * (1 - headT) * headT * cy + headT * headT * y2;
  // Tangent at t.
  const tx = 2 * (1 - headT) * (cx - x1) + 2 * headT * (x2 - cx);
  const ty = 2 * (1 - headT) * (cy - y1) + 2 * headT * (y2 - cy);
  const angle = (Math.atan2(ty, tx) * 180) / Math.PI;
  const arrowSize = UNIT * 0.36;

  // Color the shaft + head based on the march intent. Attacks stay
  // sienna red (the previous look). Reinforcements get a muted teal so
  // friendly maneuvers don't visually scream "war".
  const toneStroke = tone === 'reinforce' ? '#2c5a5a' : '#7d3a1a';
  return (
    <g className="march-line" pointerEvents="none">
      <path
        d={path}
        className={`march-line-shaft${faded ? ' fading' : ''}`}
        strokeDasharray={approxLen}
        strokeDashoffset={dashOffset}
        style={{ stroke: toneStroke }}
      />
      {!faded && progress > 0.02 && (
        <polygon
          className="march-line-head"
          transform={`translate(${bx} ${by}) rotate(${angle})`}
          points={`0,0 ${-arrowSize},${-arrowSize / 2.4} ${-arrowSize},${arrowSize / 2.4}`}
          style={{ fill: toneStroke }}
        />
      )}
    </g>
  );
};

// --------------------------------------------------------- compass rose

const CompassRose: React.FC = () => (
  <g transform="translate(-40 -40)">
    <circle cx="0" cy="0" r="38" fill="none" stroke="#7d5a3a" strokeWidth="1.6" />
    <circle cx="0" cy="0" r="32" fill="none" stroke="#7d5a3a" strokeWidth="0.6" />
    {/* compass arms */}
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
      <line
        key={deg}
        x1="0"
        y1="0"
        x2={36 * Math.sin((deg * Math.PI) / 180)}
        y2={-36 * Math.cos((deg * Math.PI) / 180)}
        stroke="#7d5a3a"
        strokeWidth={deg % 90 === 0 ? 1.4 : 0.5}
      />
    ))}
    <text x="0" y="-22" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="11" fontWeight="700" fill="#7d3a1a">北</text>
    <text x="0" y="28" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="11" fill="#564a35">南</text>
    <text x="22" y="3" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="11" fill="#564a35">东</text>
    <text x="-22" y="3" textAnchor="middle" fontFamily="'Noto Serif SC', serif" fontSize="11" fill="#564a35">西</text>
  </g>
);

// --------------------------------------------------------- forest dots

interface ForestDot {
  x: number;
  y: number;
  s: number;
}

function buildForestDots(): ForestDot[] {
  const out: ForestDot[] = [];
  for (const patch of FORESTS) {
    const [minX, minY, maxX, maxY] = bounds(patch.polygon);
    const density = patch.density ?? 0.5;
    // Deterministic Halton-ish sequence so dots scatter without RNG drift.
    // The step and edge insets are base-cell distances lifted into scaled
    // space (×GRID_SCALE) so the dot count and relative density are unchanged
    // even though the polygon bounds are now GRID_SCALE times larger.
    let i = 0;
    const step = GRID_SCALE / (0.6 + density * 1.4);
    for (let y = minY + 0.2 * GRID_SCALE; y < maxY - 0.2 * GRID_SCALE; y += step) {
      for (let x = minX + 0.2 * GRID_SCALE; x < maxX - 0.2 * GRID_SCALE; x += step) {
        const jx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const jy = (Math.sin(i * 78.233) * 43758.5453) % 1;
        const px = x + (jx - 0.5) * step * 0.6;
        const py = y + (jy - 0.5) * step * 0.6;
        if (pointInPolygon(px, py, patch.polygon)) {
          const s = 0.7 + (Math.abs(jx) % 0.6);
          out.push({ x: px, y: py, s });
        }
        i++;
      }
    }
  }
  return out;
}

function bounds(poly: Array<[number, number]>): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// --------------------------------------------------------- path midpoint

function midpointOfPath(d: string): { x: number; y: number } | null {
  // Extract the numbers from the path string and use the middle pair as a
  // rough label anchor. Good enough for short hand-authored paths.
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 4) return null;
  const mid = Math.floor(nums.length / 2 / 2) * 2;
  const x = nums[mid];
  const y = nums[mid + 1];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return { x, y };
}

// --------------------------------------------------------- generic helpers

// Clamp that copes with a degenerate range (hi < lo) and non-finite
// input. Used everywhere viewBox numbers might briefly diverge during
// a fast pan/zoom or a layout collapse — a NaN propagating into the
// SVG viewBox would silently blank the map.
function safeClamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function zoomTo(v: Viewbox, size: { w: number; h: number }, factor: number): Viewbox {
  if (size.w <= 0 || size.h <= 0 || v.w <= 0) return v;
  const newW = safeClamp(v.w * factor, size.w / MAX_ZOOM, size.w / MIN_ZOOM);
  const newH = newW * (size.h / size.w);
  return {
    x: v.x + (v.w - newW) / 2,
    y: v.y + (v.h - newH) / 2,
    w: newW,
    h: newH,
  };
}
