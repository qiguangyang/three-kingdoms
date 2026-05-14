import React, { useEffect, useRef, useState } from 'react';
import { pickName, t } from '../../i18n/locale.js';
import type { City, Faction } from '../../engine/types.js';
import { factionColor } from '../theme.js';
import {
  playClash,
  playDayTick,
  playGong,
  playMarch,
  playRetreat,
} from '../audio/battle.js';

// Wall-clock duration of the march phase (arrow rides into the target).
const MARCH_DURATION_MS = 500;

export interface BattleAnimationData {
  from: City;
  target: City;
  attacker: Faction;
  defender: Faction | null;
  attackerTroopsStart: number;
  attackerTroopsEnd: number;
  defenderTroopsStart: number;
  defenderTroopsEnd: number;
  attackerWon: boolean;
  daysTotal: number; // number of in-fiction days the battle takes
  durationMs: number; // wall-clock animation duration
}

// Derive how many days the engagement lasts based on the size of the
// casualty exchange. Bigger fights linger longer on screen (capped at
// the engine's 30-day timeout). Tiny pushes feel snappy.
export function computeBattleTiming(
  attackerStart: number,
  attackerEnd: number,
  defenderStart: number,
  defenderEnd: number,
): { daysTotal: number; durationMs: number } {
  const totalCasualties =
    Math.max(0, attackerStart - attackerEnd) +
    Math.max(0, defenderStart - defenderEnd);
  // ~1 day per 1,200 casualties, min 4 days, capped at 30 (the engine
  // timeout). A 5k rout plays in ~4 days; a 30k clash plays the full 25.
  const days = Math.min(30, Math.max(4, Math.ceil(totalCasualties / 1200)));
  // Average ~180ms per day. Slow-mo curve makes the first ~25% of the
  // duration cover only ~8% of the progress, so big battles open with a
  // tense pause before accelerating.
  const durationMs = days * 220;
  return { daysTotal: days, durationMs };
}

// Map real time (0..1) to in-fiction progress (0..1) with a cinematic
// curve: first quarter of wall-clock time advances slowly (~10% of the
// way), middle accelerates, last 10% stretches out a beat for the
// resolution. Produces a clear "calm → clash → resolution" arc.
function pacingCurve(t: number): number {
  if (t < 0.25) {
    // Slow opening: drama buildup. Quadratic ramp to 10% of progress.
    return Math.pow(t / 0.25, 2) * 0.1;
  }
  if (t < 0.9) {
    // Fast middle: linear sprint from 10% → 92%.
    return 0.1 + ((t - 0.25) / 0.65) * 0.82;
  }
  // Held finale: slow last sliver so the final number is legible.
  return 0.92 + ((t - 0.9) / 0.1) * 0.08;
}

interface Props {
  data: BattleAnimationData;
  onComplete: () => void;
  // Drives the map's march-line and pulse during the animation. The
  // host (MainScreen) maps these into MapView props.
  onMarchChange?: (state: { progress: number; faded: boolean } | null) => void;
  onBattleCityChange?: (cityId: string | null) => void;
}

// Render a centered banner showing the live state of an ongoing battle.
// Counters interpolate from start to end troop counts; the day counter
// ticks 1..daysTotal. When the timer expires we call onComplete so the
// host can flip to the BattleReport modal.
export const BattleAnimation: React.FC<Props> = ({
  data,
  onComplete,
  onMarchChange,
  onBattleCityChange,
}) => {
  const [phase, setPhase] = useState<'march' | 'engage' | 'done'>('march');
  const [progress, setProgress] = useState(0); // 0..1 for engage phase only
  const lastDayRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  // Track phase inside the RAF closure so we only fire the engage
  // transition once. The `phase` React state is for rendering.
  const phaseRef = useRef<'march' | 'engage'>('march');

  const finish = useRef(onComplete);
  finish.current = onComplete;
  // Latch the latest callback refs so the effect can stay mounted across
  // re-renders without re-creating the RAF loop.
  const marchRef = useRef(onMarchChange);
  marchRef.current = onMarchChange;
  const battleCityRef = useRef(onBattleCityChange);
  battleCityRef.current = onBattleCityChange;

  useEffect(() => {
    // March phase starts immediately with a march sound.
    playMarch();

    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;

      if (elapsed < MARCH_DURATION_MS) {
        // March phase: animate the line out, no engage panel yet.
        const mp = elapsed / MARCH_DURATION_MS;
        marchRef.current?.({ progress: mp, faded: false });
        battleCityRef.current?.(null);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Transition into engage on the first frame past the march window.
      if (phaseRef.current === 'march') {
        phaseRef.current = 'engage';
        setPhase('engage');
        marchRef.current?.({ progress: 1, faded: true });
        battleCityRef.current?.(data.target.id);
        playClash();
      }

      const engagedElapsed = elapsed - MARCH_DURATION_MS;
      const t = Math.min(1, engagedElapsed / data.durationMs);
      setProgress(t);

      // Day tick: when the displayed day advances, fire a soft tick.
      const eased = pacingCurve(t);
      const currentDay = Math.max(1, Math.ceil(eased * data.daysTotal));
      if (currentDay > lastDayRef.current) {
        lastDayRef.current = currentDay;
        if (currentDay > 1) playDayTick();
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (!completedRef.current) {
        completedRef.current = true;
        // Resolution sting matches the outcome.
        if (data.attackerWon) playGong();
        else playRetreat();
        // Clear map overlays as we hand off to the report modal.
        marchRef.current?.(null);
        battleCityRef.current?.(null);
        finish.current();
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    function onKey(e: KeyboardEvent) {
      // Esc/Enter immediately ends the animation and flips to the report.
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        setProgress(1);
        if (!completedRef.current) {
          completedRef.current = true;
          marchRef.current?.(null);
          battleCityRef.current?.(null);
          if (data.attackerWon) playGong();
          else playRetreat();
          finish.current();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', onKey);
      // Defensive: ensure overlays clear if the component unmounts early.
      marchRef.current?.(null);
      battleCityRef.current?.(null);
    };
    // Intentionally depend only on data; phase changes are owned by the
    // loop itself, and callbacks read from refs.
  }, [data]);

  // Slow-mo cinematic pacing: real time maps non-linearly into progress.
  // Both casualty interpolation and the day counter follow the same
  // curve so the timeline feels coherent.
  const eased = pacingCurve(progress);
  const atkLerp = lerp(data.attackerTroopsStart, data.attackerTroopsEnd, eased);
  const defLerp = lerp(data.defenderTroopsStart, data.defenderTroopsEnd, eased);
  const day = Math.max(1, Math.ceil(eased * data.daysTotal));

  const atkColor = factionColor(data.attacker.id);
  const defColor = factionColor(data.defender?.id ?? null);

  // During the march phase show a minimalist HUD; during engage show the
  // full counter panel.
  if (phase === 'march') {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
        <div className="panel-tight pointer-events-auto font-display text-xs tracking-widest text-ink-700">
          {t('battle.engaging', {
            from: pickName(data.from.name),
            target: pickName(data.target.name),
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="panel pointer-events-auto w-[min(28rem,92vw)] shadow-scroll">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm tracking-widest text-ink-700">
            {t('battle.engaging', {
              from: pickName(data.from.name),
              target: pickName(data.target.name),
            })}
          </h3>
          <span className="font-mono text-xs text-ink-500">
            {t('battle.dayOf', { day, total: data.daysTotal })}
          </span>
        </div>

        <div className="ink-divider my-2" />

        <Side
          color={atkColor}
          factionName={pickName(data.attacker.name)}
          troops={atkLerp}
          start={data.attackerTroopsStart}
          isAttacker
        />
        <div className="my-1 flex items-center justify-center gap-2 font-display text-[10px] tracking-widest text-ink-500">
          <span className="h-px flex-1 bg-ink-300/40" />
          <span aria-hidden>⚔</span>
          <span className="h-px flex-1 bg-ink-300/40" />
        </div>
        <Side
          color={defColor}
          factionName={data.defender ? pickName(data.defender.name) : '—'}
          troops={defLerp}
          start={data.defenderTroopsStart}
        />

        <div className="mt-2 text-right font-mono text-[10px] text-ink-500">
          {t('battle.skipHint')}
        </div>
      </div>
    </div>
  );
};

const Side: React.FC<{
  color: string;
  factionName: string;
  troops: number;
  start: number;
  isAttacker?: boolean;
}> = ({ color, factionName, troops, start, isAttacker }) => {
  const ratio = start > 0 ? Math.max(0, Math.min(1, troops / start)) : 0;
  // Track previous rendered troop count. When the integer drops we toggle
  // a one-shot CSS animation class; useRef so we don't trigger renders
  // just by tracking the old value.
  const rounded = Math.round(troops);
  const prevRef = useRef(rounded);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (rounded < prevRef.current) {
      // Bump the key so the animation re-fires even on consecutive drops.
      setFlashKey((k) => k + 1);
    }
    prevRef.current = rounded;
  }, [rounded]);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="w-24 truncate font-serif text-ink-800">{factionName}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded bg-ink-100">
        <div
          className={`absolute inset-y-0 left-0 ${
            isAttacker ? 'bg-seal-500/70' : 'bg-stone-600/70'
          }`}
          style={{
            width: `${ratio * 100}%`,
            transition: 'width 120ms linear',
          }}
        />
      </div>
      <span
        key={flashKey}
        className="w-20 text-right font-mono text-xs tabular-nums text-ink-800 troop-flash"
      >
        {rounded.toLocaleString()}
      </span>
    </div>
  );
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
