import React from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectLocale } from '../../state/selectors.js';
import { resolveDuel } from '../../state/store.js';
import { hasWebGL } from '../gfx/hasWebGL.js';
import { DuelCanvas } from './DuelCanvas.js';
import { autoResolveDuel } from './autoResolve.js';
import { DUEL_CONFIG } from '../../duel/config.js';
import { createDuelState } from '../../duel/simulate.js';
import { findSetpiece } from '../../engine/duel/setpieces.js';
import type { DuelOutcome, DuelState } from '../../duel/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';

// Cinematic HUD palette — a dark broadcast overlay over the 3D duel, mirroring
// BattleScreen's immersive treatment (deliberately distinct from the app's
// paper theme). The panels still lean on the shared `.panel` class for shape.
const GOLD = '#c9a35c';
const PAPER = '#e8dcc3';
const PAPER_DIM = '#b8ad97';

const clampPct = (n: number): number => (n < 0 ? 0 : n > 1 ? 100 : n * 100);

// One labelled vitals bar (label on the left, fill scaled to 0..100%). The
// label text is a plain node so the HUD stays queryable under jsdom.
const Bar: React.FC<{ label: string; pct: number; color: string; wide?: boolean }> = ({
  label,
  pct,
  color,
  wide,
}) => (
  <div className={wide ? 'w-72' : 'w-56'}>
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] uppercase tracking-[0.2em]" style={{ color: PAPER_DIM }}>
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums" style={{ color: PAPER_DIM }}>
        {Math.round(pct)}
      </span>
    </div>
    <div className="stat-bar mt-1" style={{ background: 'rgba(255,255,255,.10)' }}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  </div>
);

// PURE presentational HUD: given a DuelState and the boss's name key, paint the
// player's HP + stamina bars, the boss's name + HP bar, and the control hints.
// No store, no scene, no side effects — this is the jsdom-tested slice.
export const DuelHud: React.FC<{ state: DuelState; bossNameKey: MessageKey }> = ({
  state,
  bossNameKey,
}) => {
  const { player, boss } = state;
  return (
    <>
      {/* Boss banner — name + HP, centred at the top. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
        <div className="panel flex flex-col items-center gap-1" style={{ background: 'rgba(10,13,18,.78)', borderColor: 'rgba(201,163,92,.4)' }}>
          <span className="font-display text-lg tracking-[0.3em]" style={{ color: PAPER }}>
            {t(bossNameKey)}
          </span>
          <Bar label={t('duel.hud.bossHp')} pct={clampPct(boss.hp / boss.maxHp)} color="#c65a4a" wide />
        </div>
      </div>

      {/* Player vitals — bottom-left. */}
      <div className="pointer-events-none absolute bottom-4 left-4">
        <div className="panel flex flex-col gap-2" style={{ background: 'rgba(10,13,18,.78)' }}>
          <Bar label={t('duel.hud.hp')} pct={clampPct(player.hp / player.maxHp)} color="#7ac89a" />
          <Bar label={t('duel.hud.stamina')} pct={clampPct(player.stamina / player.maxStamina)} color="#c9a35c" />
        </div>
      </div>

      {/* Control hints — bottom-centre. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
        <span className="text-[11px] tracking-[0.15em]" style={{ color: PAPER_DIM, textShadow: '0 1px 6px #000' }}>
          {t('duel.hint.controls')}
        </span>
      </div>
    </>
  );
};

// Full-screen duel set-piece. Reads game.pendingDuel for the active duelId.
// When WebGL is available it mounts the real-time DuelScene (via DuelCanvas)
// under a live HUD; when it is not, it resolves the duel with the deterministic
// stat-based fallback so the campaign stays playable without a GPU. Either way
// the store's resolveDuel routes back into the campaign once the fight is
// decided — so the win/lose overlay here is mostly cosmetic.
export const DuelScreen: React.FC = () => {
  // Re-render when the language toggles.
  useSession(selectLocale);
  const game = useSession(selectGame);
  const duelId = game?.pendingDuel?.duelId ?? '';
  const setpiece = findSetpiece(duelId);
  const bossNameKey: MessageKey = setpiece
    ? (`duel.boss.${setpiece.bossId}` as MessageKey)
    : 'duel.boss.lvbu';

  // WebGL support is decided once per mount so the choice can't flip mid-fight.
  const [webgl] = React.useState(() => hasWebGL());

  // The HUD mirrors the scene's live state. Seeded with a fresh state so the
  // bars read full before the first frame arrives.
  const [live, setLive] = React.useState<DuelState>(() => createDuelState(DUEL_CONFIG.seed));

  // Throttle the scene's per-frame taps down to ~15 Hz for React — smooth
  // enough for bars, far cheaper than a setState every rendered frame. The
  // terminal (outcome) frame is always pushed so the overlay can show.
  const lastPush = React.useRef(0);
  const onFrame = React.useCallback((s: DuelState) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (s.outcome || now - lastPush.current >= 66) {
      lastPush.current = now;
      setLive(s);
    }
  }, []);

  // No-WebGL fallback: resolve the duel once via the deterministic stat model.
  // Guarded so React's double-invoke (StrictMode) can't resolve twice.
  const resolvedRef = React.useRef(false);
  React.useEffect(() => {
    if (webgl || !duelId || resolvedRef.current) return;
    resolvedRef.current = true;
    resolveDuel(autoResolveDuel(duelId, DUEL_CONFIG.seed));
  }, [webgl, duelId]);

  if (!webgl) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6" style={{ background: '#0a0d12' }}>
        <div className="panel text-center" style={{ background: 'rgba(10,13,18,.82)' }}>
          <p className="text-sm tracking-[0.15em]" style={{ color: PAPER }}>
            {t('duel.autoResolved')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#0a0d12', fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}>
      <div className="absolute inset-0">
        <DuelCanvas onFrame={onFrame} />
      </div>

      {/* Arena label — top-left. */}
      <div className="pointer-events-none absolute left-4 top-4">
        <span className="font-display text-xs tracking-[0.3em]" style={{ color: GOLD, textShadow: '0 1px 6px #000' }}>
          {setpiece ? t(setpiece.arenaKey) : t('duel.arena.hulaoguan')}
        </span>
      </div>

      <DuelHud state={live} bossNameKey={bossNameKey} />

      {live.outcome && <DuelResult outcome={live.outcome} />}
    </div>
  );
};

// After-action overlay. resolveDuel (fired by the scene's onOutcome) has already
// routed the campaign on, so this is a brief cosmetic flourish; the Continue
// button re-issues resolveDuel harmlessly (a no-op once pendingDuel is cleared).
const DuelResult: React.FC<{ outcome: DuelOutcome }> = ({ outcome }) => {
  const won = outcome === 'win';
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(5,7,10,.62)' }}>
      <div className="panel px-10 py-8 text-center" style={{ background: 'rgba(10,13,18,.85)' }}>
        <div className="font-display text-4xl tracking-[0.18em]" style={{ color: won ? '#7ac89a' : '#e07a6a' }}>
          {won ? t('duel.result.win') : t('duel.result.lose')}
        </div>
        <button className="btn btn-primary mt-6" onClick={() => resolveDuel(outcome)}>
          {t('app.continue')}
        </button>
      </div>
    </div>
  );
};
