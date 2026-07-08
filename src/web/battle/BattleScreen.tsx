import React, { useEffect } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectBattle, selectLocale } from '../../state/selectors.js';
import {
  chooseBattleGambit, finishBattle, quickResolveBattle, resolveBattleDay,
  setBattleSpeed, submitBattleOrders,
} from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { factionColor } from '../theme.js';
import {
  playCharge, playClash, playDuel, playFire, playGong, playRetreat, playRout, playVolley,
} from '../audio/battle.js';
import { BattleView } from './BattleView.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { MessageKey } from '../../i18n/types.js';

function troopTotal(session: BattleSession, factionId: string): number {
  return session.battle.units
    .filter((u) => u.factionId === factionId && u.troops > 0)
    .reduce((n, u) => n + u.troops, 0);
}

export const BattleScreen: React.FC = () => {
  useSession(selectLocale);
  const session = useSession(selectBattle);
  const [playing, setPlaying] = React.useState(false);

  // Auto-play: while playing and awaiting orders with no gambit to weigh,
  // resolve a day on an interval scaled by speed. Pause at gambit windows.
  useEffect(() => {
    if (!session || !playing) return;
    if (session.phase !== 'awaitingOrders' || session.gambits.length > 0) return;
    const id = setTimeout(() => resolveBattleDay(), 900 / session.speed);
    return () => clearTimeout(id);
  }, [session, playing]);

  // Play at most one cue per event kind for the day just resolved (works for
  // both the 3D and SVG views; silent no-op when muted or WebAudio is absent).
  useEffect(() => {
    if (!session || session.lastEvents.length === 0) return;
    const kinds = new Set(session.lastEvents.map((e) => e.kind));
    if (kinds.has('duel')) playDuel();
    if (kinds.has('fire')) playFire();
    if (kinds.has('volley')) playVolley();
    if (kinds.has('charge') || kinds.has('reserveCommitted')) playCharge();
    if (kinds.has('clash')) playClash();
    if (kinds.has('moraleBreak') || kinds.has('rout')) playRout();
    const end = session.lastEvents.find((e) => e.kind === 'end');
    if (end && end.kind === 'end') (end.attackerWon === session.playerIsAttacker ? playGong : playRetreat)();
  }, [session]);

  if (!session) return null;
  const { battle } = session;
  const atk = battle.attackerFactionId;
  const def = battle.defenderFactionId;
  const playerUnits = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded');
  const reserves = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'reserve');
  const resolved = session.phase === 'resolved';

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-2 px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">{t('battle.heading')}</h2>
        <span className="font-mono text-sm text-ink-500">{t('battle.dayOf', { day: battle.daysElapsed, total: 30 })}</span>
      </header>

      {/* Troop bars */}
      <div className="flex gap-4 text-xs">
        <Bar label={t('battle.attackers')} color={factionColor(atk)} value={troopTotal(session, atk)} />
        <Bar label={t('battle.defenders')} color={factionColor(def)} value={troopTotal(session, def)} />
      </div>

      {/* Field */}
      <div className="relative flex-1 overflow-hidden rounded border border-ink-300/40 bg-parchment-100">
        <BattleView session={session} />
      </div>

      {/* Controls */}
      {!resolved && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => resolveBattleDay()}>{t('battle.advanceDay')}</button>
          <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? t('battle.pause') : t('battle.play')}</button>
          {[1, 2, 4].map((sp) => (
            <button key={sp} className={`btn btn-ghost ${session.speed === sp ? 'font-bold text-seal-700' : ''}`} onClick={() => setBattleSpeed(sp as 1 | 2 | 4)}>
              {t('battle.speed')} ×{sp}
            </button>
          ))}
          {reserves.length > 0 && (
            <button className="btn" onClick={() => submitBattleOrders([{ kind: 'commitReserves', factionId: session.playerFactionId }])}>
              {t('battle.commitReserves')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => quickResolveBattle()}>{t('battle.quickResolve')}</button>
        </div>
      )}

      {/* Gambits */}
      {!resolved && session.gambits.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-seal-500/40 bg-seal-500/5 px-2 py-1">
          <span className="font-display text-xs tracking-widest text-seal-700">{t('battle.gambits')}</span>
          {session.gambits.map((g) => (
            <button key={g.id} className="btn btn-primary" onClick={() => { chooseBattleGambit(g.id); resolveBattleDay(); }}>
              {t(g.labelKey as MessageKey)}
            </button>
          ))}
        </div>
      )}

      {/* Per-unit orders */}
      {!resolved && (
        <div className="max-h-28 overflow-y-auto rounded border border-ink-300/40 px-2 py-1">
          <div className="text-[11px] uppercase tracking-widest text-ink-500">{t('battle.yourOrders')}</div>
          <ul className="flex flex-wrap gap-2">
            {playerUnits.map((u) => (
              <li key={u.id} className="flex items-center gap-1 rounded bg-parchment-50 px-1.5 py-0.5 text-xs">
                <span className="font-mono">{u.troops.toLocaleString()}</span>
                <button className="btn-ghost text-[11px]" onClick={() => submitBattleOrders([{ kind: 'hold', unitId: u.id }])}>{t('battle.hold')}</button>
                <button className="btn-ghost text-[11px]" onClick={() => {
                  const foe = battle.units.find((e) => e.factionId !== u.factionId && e.state === 'fielded');
                  if (foe) submitBattleOrders([{ kind: 'charge', unitId: u.id, targetUnitId: foe.id }]);
                }}>{t('battle.charge')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* After-action */}
      {resolved && (
        <div className="rounded border border-ink-300/50 bg-parchment-50 px-4 py-3">
          <div className={`font-display text-lg tracking-widest ${session.attackerWon === session.playerIsAttacker ? 'text-emerald-700' : 'text-seal-700'}`}>
            {session.attackerWon === session.playerIsAttacker ? t('battle.victoryTitle') : t('battle.defeatTitle')}
          </div>
          <button className="btn btn-primary mt-2" autoFocus onClick={() => finishBattle()}>{t('battle.finish')}</button>
        </div>
      )}
    </div>
  );
};

const Bar: React.FC<{ label: string; color: string; value: number }> = ({ label, color, value }) => (
  <div className="flex items-center gap-2">
    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
    <span className="text-ink-600">{label}</span>
    <span className="font-mono tabular-nums text-ink-800">{value.toLocaleString()}</span>
  </div>
);
