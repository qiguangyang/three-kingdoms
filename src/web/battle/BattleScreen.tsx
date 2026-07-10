import React, { useEffect } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectBattle, selectLocale } from '../../state/selectors.js';
import {
  chooseBattleDecision, chooseBattleGambit, finishBattle, quickResolveBattle, resolveBattleDay,
  setBattleSpeed, submitBattleOrders,
} from '../../state/store.js';
import { selectGame } from '../../state/selectors.js';
import { t, pickName } from '../../i18n/locale.js';
import { factionColor, FACTION_GLYPH } from '../theme.js';
import { CITIES } from '../../data/cities.js';
import { GENERALS } from '../../data/generals/index.js';
import {
  playCharge, playClash, playDuel, playFire, playGong, playRetreat, playRout, playVolley,
  startBattleMusic, stopBattleMusic, setBattleIntensity, isMuted, toggleMuted,
} from '../audio/battle.js';
import { BattleView } from './BattleView.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { MessageKey } from '../../i18n/types.js';

// Cinematic HUD palette — a dark, broadcast-style overlay on the 3D battle,
// deliberately distinct from the app's paper theme (this is an immersive mode).
const GOLD = '#c9a35c';
const PAPER = '#e8dcc3';
const PAPER_DIM = '#b8ad97';
const LINE = 'rgba(201,163,92,.26)';
const PANEL: React.CSSProperties = {
  background: 'rgba(10,13,18,.82)',
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  color: PAPER,
  boxShadow: '0 8px 30px rgba(0,0,0,.45)',
};

function troopTotal(session: BattleSession, factionId: string): number {
  return session.battle.units
    .filter((u) => u.factionId === factionId && u.troops > 0)
    .reduce((n, u) => n + u.troops, 0);
}

export const BattleScreen: React.FC = () => {
  useSession(selectLocale);
  const session = useSession(selectBattle);
  const game = useSession(selectGame);
  const [playing, setPlaying] = React.useState(false);
  // Pre-battle cinematic title card, shown once per battle (reset on a new city).
  const [introOpen, setIntroOpen] = React.useState(true);
  // A brief cinematic caption for the most dramatic event of the day just resolved.
  const [caption, setCaption] = React.useState<{ key: MessageKey; n: number } | null>(null);
  const capN = React.useRef(0);
  // Identity of the last-processed lastEvents array (so cues/captions fire once
  // per resolved day, not on every unrelated session mutation) and the last
  // captioned key (so a highlight doesn't re-flash / strobe at high speed).
  const lastEventsRef = React.useRef<unknown>(null);
  const lastCapKey = React.useRef<MessageKey | null>(null);
  // Documentary narration: a persistent subtitle describing the current day, plus
  // an act label that advances deploy -> engage -> decide as the battle unfolds.
  const [narr, setNarr] = React.useState<{ key: MessageKey; n: number } | null>(null);
  const narrN = React.useRef(0);
  const combatStarted = React.useRef(false);
  // Full-screen stratagem reveal card (when the player unleashes a gambit).
  const [reveal, setReveal] = React.useState<{ nameKey: MessageKey; descKey: MessageKey; n: number } | null>(null);
  const revealN = React.useRef(0);
  const [muted, setMuted] = React.useState(isMuted());
  // Reset the per-battle presentation state when a new battle (city) opens.
  const cityId = session?.battle.cityId;
  useEffect(() => { setIntroOpen(true); combatStarted.current = false; setNarr(null); setReveal(null); }, [cityId]);
  // Music bed: stop on unmount, and stop once the battle is decided.
  useEffect(() => () => stopBattleMusic(), []);
  const phase = session?.phase;
  useEffect(() => { if (phase === 'resolved') stopBattleMusic(); }, [phase]);

  // Auto-play: while playing and awaiting orders, resolve a day on an interval
  // scaled by speed. A gambit window only slows the cadence (giving you a moment
  // to seize it) rather than stalling the battle — so it keeps flowing into the
  // fight instead of freezing on the first opportunity.
  useEffect(() => {
    if (!session || !playing || session.phase !== 'awaitingOrders') return;
    const delay = session.gambits.length > 0 ? 2600 : 900 / session.speed;
    const id = setTimeout(() => {
      // Press the assault: order the player's blocks to charge the nearest foe so
      // the battle closes and actually fights, instead of the passive default
      // "dripping advance" that stalls in front of a walled garrison.
      const mine = session.battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded');
      const foe = session.battle.units.find((e) => e.factionId !== session.playerFactionId && (e.state === 'fielded' || e.state === 'reserve'));
      if (foe && mine.length > 0) {
        submitBattleOrders(mine.map((u) => ({ kind: 'charge', unitId: u.id, targetUnitId: foe.id })));
      }
      resolveBattleDay();
    }, delay);
    return () => clearTimeout(id);
  }, [session, playing]);

  // Play at most one cue per event kind for the day just resolved (works for
  // both the 3D and SVG views; silent no-op when muted or WebAudio is absent).
  useEffect(() => {
    if (!session || session.lastEvents.length === 0) return;
    // Only react to a genuinely new day's events. Speed changes and order
    // submissions shallow-copy the session but keep the SAME lastEvents array;
    // only resolveDay/autoResolve assign a fresh one — so gate on its identity to
    // avoid replaying cues + re-flashing the caption on unrelated interactions.
    if (session.lastEvents === lastEventsRef.current) return;
    lastEventsRef.current = session.lastEvents;
    const kinds = new Set<string>(session.lastEvents.map((e) => e.kind));
    if (kinds.has('duel')) playDuel();
    if (kinds.has('fire')) playFire();
    if (kinds.has('volley')) playVolley();
    if (kinds.has('charge') || kinds.has('reserveCommitted')) playCharge();
    if (kinds.has('clash')) playClash();
    if (kinds.has('moraleBreak') || kinds.has('rout')) playRout();
    const end = session.lastEvents.find((e) => e.kind === 'end');
    if (end && end.kind === 'end') (end.attackerWon === session.playerIsAttacker ? playGong : playRetreat)();

    // Caption the single most dramatic event of the day. Only rare, decisive beats
    // are captioned (clash/volley happen almost every engaged day and would strobe
    // at ×4 autoplay), and a highlight never re-flashes the same word back-to-back.
    const CAPTIONS: Array<[string, MessageKey]> = [
      ['fire', 'battle.caption.fire'],
      ['flood', 'battle.caption.flood'],
      ['duel', 'battle.caption.duel'],
      ['moraleBreak', 'battle.caption.rout'],
      ['rout', 'battle.caption.rout'],
      ['reserveCommitted', 'battle.caption.charge'],
      ['charge', 'battle.caption.charge'],
    ];
    const hit = CAPTIONS.find(([k]) => kinds.has(k));
    if (hit && hit[1] !== lastCapKey.current) {
      lastCapKey.current = hit[1];
      capN.current += 1;
      setCaption({ key: hit[1], n: capN.current });
    }

    // Narrate every day (a full descriptive line, not just the punchy caption).
    const NARR: Array<[string, MessageKey]> = [
      ['fire', 'battle.narr.fire'],
      ['flood', 'battle.narr.flood'],
      ['duel', 'battle.narr.duel'],
      ['moraleBreak', 'battle.narr.rout'],
      ['rout', 'battle.narr.rout'],
      ['clash', 'battle.narr.clash'],
      ['charge', 'battle.narr.charge'],
      ['reserveCommitted', 'battle.narr.charge'],
      ['volley', 'battle.narr.volley'],
    ];
    const fighting = ['fire', 'flood', 'duel', 'clash', 'volley', 'charge', 'rout', 'moraleBreak'].some((k) => kinds.has(k));
    if (fighting) combatStarted.current = true;
    // Swell the music when blood is spilled; ease it back on quiet days.
    setBattleIntensity(fighting ? 0.9 : combatStarted.current ? 0.5 : 0.2);
    const nh = NARR.find(([k]) => kinds.has(k));
    narrN.current += 1;
    setNarr({ key: nh ? nh[1] : 'battle.narr.deploy', n: narrN.current });
  }, [session]);

  if (!session) return null;
  const { battle } = session;
  const atk = battle.attackerFactionId;
  const def = battle.defenderFactionId;
  const atkT = troopTotal(session, atk);
  const defT = troopTotal(session, def);
  const maxT = Math.max(atkT, defT, 1);
  const playerUnits = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded');
  const reserves = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'reserve');
  const resolved = session.phase === 'resolved';
  const won = session.attackerWon === session.playerIsAttacker;
  const act: MessageKey = resolved ? 'battle.act.decide' : combatStarted.current ? 'battle.act.engage' : 'battle.act.deploy';

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: '#0a0d12', fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}
    >
      {/* Full-bleed 3D battlefield */}
      <div className="absolute inset-0">
        <BattleView session={session} />
      </div>

      {/* Cinematic letterbox + vignette */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16" style={{ background: 'linear-gradient(#000c, transparent)' }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40" style={{ background: 'linear-gradient(transparent, #000d)' }} />
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 220px rgba(0,0,0,.6)' }} />

      {/* Intel panel — brand, day, faction strengths */}
      <div className="absolute left-5 top-5 w-72 px-4 py-3" style={PANEL}>
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 place-items-center rounded"
            style={{ background: '#b3382c', color: '#f3e4cf', fontFamily: "'Noto Serif TC', serif", fontWeight: 900, fontSize: 18 }}
            aria-hidden
          >
            战
          </span>
          <div>
            <div className="font-display text-lg leading-tight" style={{ letterSpacing: '0.3em', color: PAPER }}>
              {t('battle.heading')}
            </div>
            <div className="mt-0.5 text-[10px]" style={{ letterSpacing: '0.22em', color: GOLD }}>
              {t('battle.dayOf', { day: battle.daysElapsed, total: 30 })}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2.5 pt-3" style={{ borderTop: `1px dashed ${LINE}` }}>
          <FactionRow label={t('battle.attackers')} color={factionColor(atk)} troops={atkT} max={maxT} />
          <FactionRow label={t('battle.defenders')} color={factionColor(def)} troops={defT} max={maxT} />
        </div>
      </div>

      {/* Act label (documentary chapter) */}
      {!introOpen && narr && (
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
          <span className="font-display" style={{ letterSpacing: '0.4em', color: GOLD, fontSize: 15, textShadow: '0 2px 12px #000' }}>
            {t(act)}
          </span>
        </div>
      )}

      {/* Cinematic event caption */}
      {caption && !resolved && (
        <div key={`cap-${caption.n}`} className="battle-caption pointer-events-none absolute inset-x-0 top-[15%] flex justify-center">
          <span
            className="font-display"
            style={{ fontSize: 'clamp(28px, 4.4vw, 52px)', fontWeight: 900, letterSpacing: '0.2em', color: '#f3e5c6', textShadow: '0 2px 18px #000, 0 0 34px rgba(201,163,92,.45)' }}
          >
            {t(caption.key)}
          </span>
        </div>
      )}

      {/* Documentary narration subtitle */}
      {!introOpen && !resolved && narr && (
        <div key={`narr-${narr.n}`} className="battle-narr pointer-events-none absolute inset-x-0 bottom-[20%] flex justify-center px-6">
          <span
            className="font-display text-center"
            style={{ fontSize: 'clamp(15px, 2vw, 22px)', letterSpacing: '0.14em', color: PAPER, fontWeight: 300, textShadow: '0 2px 14px #000, 0 0 4px #000' }}
          >
            {t(narr.key)}
          </span>
        </div>
      )}

      {/* Bottom command cluster */}
      {!resolved && (
        <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-4">
          {/* Gambit opportunities — highlighted above the controls */}
          {session.gambits.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2" style={{ ...PANEL, borderColor: 'rgba(201,163,92,.5)' }}>
              <span className="font-display text-xs" style={{ letterSpacing: '0.28em', color: GOLD }}>{t('battle.gambits')}</span>
              {/* One button per distinct stratagem: chooseGambit resolves by id
                  (first match), so duplicate-id gambits from different units are
                  the same option — showing them twice misleads and collides keys. */}
              {session.gambits.filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i).map((g) => (
                <CinBtn key={g.id} variant="gold" onClick={() => {
                  revealN.current += 1;
                  setReveal({ nameKey: g.labelKey as MessageKey, descKey: `battle.reveal.${g.id}` as MessageKey, n: revealN.current });
                  chooseBattleGambit(g.id);
                  resolveBattleDay();
                }}>
                  {t(g.labelKey as MessageKey)}
                </CinBtn>
              ))}
            </div>
          )}

          {/* Maneuver levers — the commander's contextual moves. */}
          {session.offeredDecisions.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2" style={PANEL}>
              <span className="font-display text-xs" style={{ letterSpacing: '0.28em', color: GOLD }}>{t('battle.decision.tray')}</span>
              {session.offeredDecisions.map((d) => (
                <CinBtn key={d.id} onClick={() => { chooseBattleDecision(d.id); resolveBattleDay(); }}>
                  {t(d.labelKey as MessageKey)}
                </CinBtn>
              ))}
            </div>
          )}

          {/* Primary controls */}
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2" style={PANEL}>
            <CinBtn variant="gold" onClick={() => resolveBattleDay()}>{t('battle.advanceDay')}</CinBtn>
            <CinBtn onClick={() => setPlaying((p) => !p)}>{playing ? t('battle.pause') : t('battle.play')}</CinBtn>
            <span className="mx-1 h-5 w-px" style={{ background: LINE }} />
            {[1, 2, 4].map((sp) => (
              <CinBtn key={sp} active={session.speed === sp} onClick={() => setBattleSpeed(sp as 1 | 2 | 4)}>
                {t('battle.speed')} ×{sp}
              </CinBtn>
            ))}
            {reserves.length > 0 && (
              <>
                <span className="mx-1 h-5 w-px" style={{ background: LINE }} />
                <CinBtn onClick={() => submitBattleOrders([{ kind: 'commitReserves', factionId: session.playerFactionId }])}>
                  {t('battle.commitReserves')}
                </CinBtn>
              </>
            )}
            <span className="mx-1 h-5 w-px" style={{ background: LINE }} />
            <CinBtn onClick={() => quickResolveBattle()}>{t('battle.quickResolve')}</CinBtn>
            <CinBtn onClick={() => {
              const m = toggleMuted();
              setMuted(m);
              if (m) stopBattleMusic();
              else startBattleMusic();
            }}>{muted ? `🔇 ${t('battle.unmute')}` : `🔊 ${t('battle.mute')}`}</CinBtn>
          </div>

          {/* Per-unit orders */}
          {playerUnits.length > 0 && (
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 px-3 py-1.5" style={PANEL}>
              <span className="text-[10px] uppercase" style={{ letterSpacing: '0.2em', color: PAPER_DIM }}>{t('battle.yourOrders')}</span>
              {playerUnits.map((u) => (
                <span key={u.id} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(255,255,255,.05)' }}>
                  <span className="font-mono tabular-nums" style={{ color: PAPER_DIM }}>{u.troops.toLocaleString()}</span>
                  <button className="text-[11px]" style={{ color: GOLD }} onClick={() => submitBattleOrders([{ kind: 'hold', unitId: u.id }])}>{t('battle.hold')}</button>
                  <button className="text-[11px]" style={{ color: GOLD }} onClick={() => {
                    const foe = battle.units.find((e) => e.factionId !== u.factionId && e.state === 'fielded');
                    if (foe) submitBattleOrders([{ kind: 'charge', unitId: u.id, targetUnitId: foe.id }]);
                  }}>{t('battle.charge')}</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stratagem reveal card */}
      {reveal && !resolved && (
        <div key={`reveal-${reveal.n}`} className="battle-reveal pointer-events-none absolute inset-0 z-30 grid place-items-center"
          style={{ background: 'radial-gradient(circle at 50% 46%, rgba(70,24,14,.42), rgba(6,7,10,.74) 68%)' }}>
          <div className="text-center">
            <div style={{ letterSpacing: '0.55em', color: GOLD, fontSize: 13, fontWeight: 600 }}>{t('battle.reveal.tag')}</div>
            <div className="font-display" style={{ fontSize: 'clamp(58px, 10vw, 132px)', fontWeight: 900, letterSpacing: '0.16em', color: '#f5e7c6', textShadow: '0 4px 30px #000, 0 0 54px rgba(201,163,92,.5)', margin: '0.08em 0 0.12em' }}>
              {t(reveal.nameKey)}
            </div>
            <div className="font-display" style={{ letterSpacing: '0.18em', color: PAPER_DIM, fontSize: 'clamp(15px, 1.9vw, 22px)' }}>{t(reveal.descKey)}</div>
          </div>
        </div>
      )}

      {/* After-action overlay */}
      {resolved && (
        <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(5,7,10,.62)' }}>
          <div className="px-10 py-8 text-center" style={PANEL}>
            <div className="text-[11px]" style={{ letterSpacing: '0.4em', color: GOLD }}>{t('battle.heading')}</div>
            <div
              className="mt-3 font-display text-4xl"
              style={{ letterSpacing: '0.18em', color: won ? '#7ac89a' : '#e07a6a' }}
            >
              {won ? t('battle.victoryTitle') : t('battle.defeatTitle')}
            </div>
            <div className="mt-6">
              <CinBtn variant="gold" onClick={() => finishBattle()}>{t('battle.finish')}</CinBtn>
            </div>
          </div>
        </div>
      )}

      {/* Pre-battle cinematic title card */}
      {introOpen && !resolved && (
        <BattleIntro session={session} game={game} onBegin={() => { setIntroOpen(false); setPlaying(true); if (!muted) startBattleMusic(); }} />
      )}
    </div>
  );
};

// The reference's signature: a dark cinematic title card that opens each battle —
// battle name in large calligraphy, the era, a one-line dispatch of the setup, the
// two forces with their commanders and strengths, and a Begin control.
const BattleIntro: React.FC<{ session: BattleSession; game: import('../../engine/types.js').GameState | null; onBegin: () => void }> = ({ session, game, onBegin }) => {
  const b = session.battle;
  const atk = b.attackerFactionId;
  const def = b.defenderFactionId;
  const atkT = troopTotal(session, atk);
  const defT = troopTotal(session, def);
  const maxT = Math.max(atkT, defT, 1);
  const city = CITIES[b.cityId]?.name;
  const cityStr = city ? pickName(city) : b.cityId;
  const leadUnit = b.units
    .filter((u) => u.factionId === atk && u.generalId && u.troops > 0)
    .sort((p, q) => q.troops - p.troops)[0];
  const leadName = leadUnit ? pickName(GENERALS[leadUnit.generalId]?.name ?? { zh: '', en: '' }) : '';
  const atkGenerals = b.units
    .filter((u) => u.factionId === atk && u.generalId)
    .map((u) => pickName(GENERALS[u.generalId]?.name ?? { zh: '', en: '' }))
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');
  const title = t('battle.intro.title', city ? { city } : { city: cityStr });

  return (
    <div
      className="absolute inset-0 z-20 overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 32% 46%, rgba(60,26,14,.55), rgba(10,13,18,.94) 62%), #0a0d12', animation: 'battleIntroIn .5s ease-out' }}
    >
      {/* huge faded calligraphy of the title on the right */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-[4%] flex items-center font-display"
        style={{ writingMode: 'vertical-rl', fontSize: 'clamp(80px, 15vw, 200px)', fontWeight: 900, letterSpacing: '0.08em', color: 'rgba(201,163,92,.14)', whiteSpace: 'nowrap', textShadow: '0 6px 40px #000' }}
      >
        {cityStr}
      </div>

      <div className="absolute left-[7%] top-1/2 w-[min(560px,60vw)] -translate-y-1/2">
        <div className="text-[11px]" style={{ letterSpacing: '0.42em', color: GOLD }}>
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: '#b3382c' }} />
          {t('battle.intro.tag')}
        </div>
        <div className="mt-3 font-display" style={{ fontSize: 'clamp(34px, 5vw, 60px)', fontWeight: 900, letterSpacing: '0.12em', color: PAPER, textShadow: '0 3px 22px #000' }}>
          {title}
        </div>
        {game && (
          <div className="mt-1 text-xs" style={{ letterSpacing: '0.24em', color: PAPER_DIM }}>
            {t('battle.intro.era', { year: game.year, month: game.month })}
          </div>
        )}
        <div className="mt-4 h-px w-40" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)` }} />
        <p className="mt-4 text-sm leading-loose" style={{ color: PAPER_DIM, fontWeight: 300, maxWidth: '46ch' }}>
          {t('battle.intro.narr', { attacker: leadName, atk: atkT.toLocaleString(), city: city ?? cityStr, def: defT.toLocaleString() })}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <IntroForce label={atkGenerals || t('battle.attackers')} glyph={FACTION_GLYPH[atk] ?? '·'} color={factionColor(atk)} troops={atkT} max={maxT} />
          <IntroForce label={t('battle.intro.garrison')} glyph={FACTION_GLYPH[def] ?? '·'} color={factionColor(def)} troops={defT} max={maxT} />
        </div>

        <button
          onClick={onBegin}
          className="mt-8 rounded px-8 py-2.5 font-display"
          style={{ background: 'linear-gradient(180deg, rgba(179,56,44,.9), rgba(120,32,26,.9))', border: `1px solid ${GOLD}`, color: '#f4e6cb', letterSpacing: '0.3em', fontWeight: 700, boxShadow: '0 6px 26px rgba(0,0,0,.5)' }}
        >
          {t('battle.intro.begin')}
        </button>
      </div>
    </div>
  );
};

// One force row inside the title card: seal glyph, commanders, strength bar.
const IntroForce: React.FC<{ label: string; glyph: string; color: string; troops: number; max: number }> = ({ label, glyph, color, troops, max }) => (
  <div className="flex items-center gap-3">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded font-display" style={{ background: `${color}22`, border: `1px solid ${color}`, color, fontWeight: 900, fontSize: 18 }}>
      {glyph}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm" style={{ color: PAPER }}>{label}</span>
        <span className="font-mono text-xs tabular-nums" style={{ color: PAPER_DIM }}>{troops.toLocaleString()}</span>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded" style={{ background: 'rgba(255,255,255,.08)' }}>
        <span className="block h-full rounded" style={{ width: `${(troops / max) * 100}%`, background: `linear-gradient(90deg, ${color}55, ${color})` }} />
      </div>
    </div>
  </div>
);

// A single faction's strength: colour swatch, name, troop count, and a bar
// filling relative to the stronger side — the campaign-map "power" read.
const FactionRow: React.FC<{ label: string; color: string; troops: number; max: number }> = ({ label, color, troops, max }) => (
  <div>
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs" style={{ color: PAPER }}>{label}</span>
      </span>
      <span className="font-mono text-[11px] tabular-nums" style={{ color: PAPER_DIM }}>{troops.toLocaleString()}</span>
    </div>
    <div className="mt-1 h-[5px] overflow-hidden rounded" style={{ background: 'rgba(255,255,255,.08)' }}>
      <span
        className="block h-full rounded transition-[width] duration-1000 ease-out"
        style={{ width: `${(troops / max) * 100}%`, background: `linear-gradient(90deg, ${color}55, ${color})` }}
      />
    </div>
  </div>
);

// Dark-glass HUD button; `gold` is the primary/emphasis variant, `active`
// marks a selected toggle (e.g. current speed).
const CinBtn: React.FC<{ onClick: () => void; children: React.ReactNode; variant?: 'gold' | 'plain'; active?: boolean }> = ({ onClick, children, variant = 'plain', active = false }) => {
  const gold = variant === 'gold';
  return (
    <button
      onClick={onClick}
      className="rounded px-3 py-1.5 text-xs transition-colors"
      style={{
        background: gold ? 'linear-gradient(180deg, rgba(201,163,92,.28), rgba(201,163,92,.14))' : active ? 'rgba(201,163,92,.16)' : 'rgba(255,255,255,.05)',
        border: `1px solid ${gold || active ? 'rgba(201,163,92,.55)' : LINE}`,
        color: gold ? '#f4e6cb' : active ? GOLD : PAPER,
        letterSpacing: '0.08em',
        fontWeight: gold ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
};
