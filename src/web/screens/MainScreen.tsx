import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectLocale } from '../../state/selectors.js';
import {
  advanceDays,
  dismissTurnDigest,
  dispatchPlayer,
  endTurn,
  gameStore,
  schedulePlayer,
  setScreen,
  setSelectedCity,
  toggleLocale,
} from '../../state/store.js';
import { WorldMapView } from '../map/WorldMapView.js';
import { StatusBar } from '../components/StatusBar.js';
import { Sidebar } from '../components/Sidebar.js';
import { WorldNewsFeed } from '../components/WorldNewsFeed.js';
import { FactionPanel } from '../components/FactionPanel.js';
import { TurnDigest } from '../components/TurnDigest.js';
import { FloatingPanel } from '../components/FloatingPanel.js';
import { factionColor } from '../theme.js';
import { startMapMusic, stopMapMusic } from '../audio/battle.js';
import { CommandMenu, type MenuOption } from '../components/CommandMenu.js';
import { Dialog } from '../components/Dialog.js';
import { adjacentCities } from '../../engine/map.js';
import { marchDuration } from '../../engine/pendingOp.js';
import { factionGenerals } from '../../engine/selectors.js';
import type { City, GameState, General, StrategicCommand } from '../../engine/types.js';
import { pickName, t } from '../../i18n/locale.js';
import { ActionResult, type ActionResultData, type StatDelta } from '../components/ActionResult.js';
import { DefectDialog } from '../components/DefectDialog.js';
import { TransferDialog } from '../components/TransferDialog.js';

type Modal =
  | { kind: 'none' }
  | { kind: 'menu' }
  | { kind: 'internalAffairs'; city: City }
  | { kind: 'attackTarget'; from: City; targets: City[] }
  | { kind: 'help' }
  | { kind: 'info'; title: string; body: React.ReactNode }
  | { kind: 'actionResult'; data: ActionResultData }
  | { kind: 'defect'; target: General }
  | { kind: 'transfer'; general: General }
  // New: after picking a target, the player composes the expedition —
  // checks generals to send and sets the troop count. The march op is
  // scheduled on confirm.
  | { kind: 'attackComposer'; from: City; target: City };

export const MainScreen: React.FC = () => {
  useSession(selectLocale);
  const game = useSession(selectGame);
  const selectedCityId = useSession((s) => s.ui.selectedCityId);
  const turnDigest = useSession((s) => s.ui.turnDigest);
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  // Campaign-map background theme: plays while the map is on screen and stops on
  // leave (a battle takes over its own music, then the map theme resumes).
  useEffect(() => {
    startMapMusic();
    return () => stopMapMusic();
  }, []);
  // Derive map overlays from the engine's pendingOps. The map shows
  // every march in flight and every city under siege so the player can
  // see the campaign at a glance.
  const pendingMarches = useMemo(() => {
    if (!game) return undefined;
    return game.pendingOps
      .filter((op): op is Extract<typeof op, { kind: 'march' }> => op.kind === 'march')
      .map((op) => ({
        fromCityId: op.fromCityId,
        toCityId: op.toCityId,
        progress: 1 - op.daysRemaining / Math.max(1, op.durationDays),
        intent: op.intent,
      }));
  }, [game]);
  const siegeCityIds = useMemo(() => {
    if (!game) return undefined;
    return game.pendingOps
      .filter((op): op is Extract<typeof op, { kind: 'siege' }> => op.kind === 'siege')
      .map((op) => op.targetCityId);
  }, [game]);
  // Internal-affairs ops in flight, by city. One arc per city; if a
  // city has multiple ops queued we surface the one closest to
  // completion (highest progress) so the map shows imminent finishes.
  const internalOpsByCity = useMemo(() => {
    if (!game) return undefined;
    const out: Array<{
      cityId: string;
      kind: 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit';
      progress: number;
    }> = [];
    type Info = { kind: 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit'; progress: number };
    const byCity = new Map<string, Info>();
    for (const op of game.pendingOps) {
      if (
        op.kind !== 'develop' &&
        op.kind !== 'commerce' &&
        op.kind !== 'govern' &&
        op.kind !== 'patrol' &&
        op.kind !== 'search' &&
        op.kind !== 'recruit'
      )
        continue;
      const progress = 1 - op.daysRemaining / Math.max(1, op.durationDays);
      const existing = byCity.get(op.cityId);
      if (!existing || progress > existing.progress) {
        byCity.set(op.cityId, { kind: op.kind, progress });
      }
    }
    for (const [cityId, info] of byCity) out.push({ cityId, ...info });
    return out;
  }, [game]);
  // Step the selection to the next city in a given compass direction. If no
  // city is selected, pick the player's capital (first owned city) so the
  // very first arrow press always lands somewhere useful.
  const stepSelection = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      if (!game) return;
      const cities = Object.values(game.cities);
      const current = selectedCityId ? game.cities[selectedCityId] : undefined;
      if (!current) {
        // Default to a player-owned city, falling back to any city.
        const owned = cities.find((c) => c.factionId === game.playerFactionId);
        const seed = owned ?? cities[0];
        if (!seed) return;
        setSelectedCity(seed.id);
        return;
      }
      const next = nextCityInDirection(current, cities, dir);
      if (next) setSelectedCity(next.id);
    },
    [game, selectedCityId],
  );

  // Global keyboard shortcuts (when no modal is open).
  useEffect(() => {
    if (!game) return;
    function handler(e: KeyboardEvent) {
      if (modal.kind !== 'none') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      switch (e.key) {
        case ' ':
        case 'n':
          e.preventDefault();
          // n / Space advances one in-game week (7 days), letting ops
          // tick toward completion without skipping past the action.
          advanceDays(7);
          break;
        case 'N':
          // Shift+N fast-forwards a full month (30 days).
          e.preventDefault();
          endTurn();
          break;
        case 'm':
          e.preventDefault();
          setModal({ kind: 'menu' });
          break;
        case 'b':
          e.preventDefault();
          openBuildForSelected();
          break;
        case 'a':
          e.preventDefault();
          openAttackForSelected();
          break;
        case 's':
          e.preventDefault();
          setScreen({ kind: 'save' });
          break;
        case 'L':
          e.preventDefault();
          setScreen({ kind: 'load' });
          break;
        // Accept Shift+l too — some keyboard event implementations (notably
        // Playwright-driven tests) leave `key` lowercase even with Shift
        // held. Real browsers send 'L'; we accept both for robustness.
        case 'l':
          if (e.shiftKey) {
            e.preventDefault();
            setScreen({ kind: 'load' });
            return;
          }
          // Otherwise fall through to the lowercase-l handler below by
          // re-routing as cursor navigation.
          e.preventDefault();
          stepSelection('right');
          break;
        case 'g':
          e.preventDefault();
          toggleLocale();
          break;
        case 'i':
          e.preventDefault();
          setScreen({ kind: 'generals' });
          break;
        case '?':
          e.preventDefault();
          setModal({ kind: 'help' });
          break;
        case 'h':
        case 'ArrowLeft':
          e.preventDefault();
          stepSelection('left');
          break;
        case 'ArrowRight':
          // 'l' (and Shift+l) handled above. Only the arrow form lives here.
          e.preventDefault();
          stepSelection('right');
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          stepSelection('up');
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          stepSelection('down');
          break;
        case 'Enter':
          // Enter on the map opens the command menu (mirrors the docked menu
          // a selected city already shows).
          e.preventDefault();
          setModal({ kind: 'menu' });
          break;
        case 'Escape':
          // Esc clears the city selection (parallels Enter to select).
          e.preventDefault();
          setSelectedCity(null);
          break;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [game, modal.kind, selectedCityId, stepSelection]);

  const openBuildForSelected = useCallback(() => {
    if (!game) return;
    if (!selectedCityId) {
      setModal({
        kind: 'info',
        title: t('menu.internalAffairs'),
        body: <p>{t('sidebar.empty')} — {t('help.select')}</p>,
      });
      return;
    }
    const c = game.cities[selectedCityId];
    if (!c || c.factionId !== game.playerFactionId) {
      setModal({
        kind: 'info',
        title: t('menu.internalAffairs'),
        body: <p>{pickName(c?.name ?? { zh: '?', en: '?' })}: not your city.</p>,
      });
      return;
    }
    setModal({ kind: 'internalAffairs', city: c });
  }, [game, selectedCityId]);

  const openAttackForSelected = useCallback(() => {
    if (!game) return;
    if (!selectedCityId) {
      setModal({
        kind: 'info',
        title: t('menu.attack'),
        body: <p>{t('help.select')}</p>,
      });
      return;
    }
    const c = game.cities[selectedCityId];
    if (!c || c.factionId !== game.playerFactionId) {
      setModal({
        kind: 'info',
        title: t('menu.attack'),
        body: <p>{pickName(c?.name ?? { zh: '?', en: '?' })}: not your city.</p>,
      });
      return;
    }
    const targets = adjacentCities(game, c.id).filter((n) => n.factionId !== game.playerFactionId);
    if (targets.length === 0) {
      setModal({
        kind: 'info',
        title: t('menu.attack'),
        body: <p>No adjacent hostile or neutral city.</p>,
      });
      return;
    }
    setModal({ kind: 'attackTarget', from: c, targets });
  }, [game, selectedCityId]);

  if (!game) return null;
  const selectedCity = selectedCityId ? game.cities[selectedCityId] : undefined;

  const playerFaction = game.factions[game.playerFactionId];
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Full-screen campaign map — everything else floats on top of it. */}
      <div className="absolute inset-0">
        <WorldMapView
          game={game}
          selectedCityId={selectedCityId}
          onSelectCity={setSelectedCity}
          pendingMarches={pendingMarches}
          siegeCityIds={siegeCityIds}
          internalOps={internalOpsByCity}
        />
      </div>

      {/* Floating, collapsible HUD panels (collapsed by default so the map stays
          clear). Status top-left, city detail top-right, chronicle bottom-left,
          the powers ranking bottom-right. */}
      <FloatingPanel
        position="left-3 top-3"
        bodyClass="w-max"
        title={
          <span className="flex items-center gap-1.5">
            {playerFaction && (
              <span className="stamp-square" style={{ backgroundColor: factionColor(playerFaction.id) }} aria-hidden>
                {playerFaction.id === '__neutral__' ? '·' : pickName(playerFaction.name)[0] ?? '·'}
              </span>
            )}
            <span>{playerFaction ? pickName(playerFaction.name) : t('status.faction')}</span>
            <span className="text-ink-500">{t('status.month_long', { year: game.year, month: game.month })}</span>
            <span className="font-mono text-[10px] text-ink-400">D{game.day}/30</span>
          </span>
        }
      >
        <StatusBar game={game} />
      </FloatingPanel>

      <FloatingPanel position="right-3 top-3" align="right" title={t('sidebar.city')} bodyClass="w-80 max-h-[72vh]">
        <div className="max-h-[72vh]">
          <Sidebar
            game={game}
            selectedCityId={selectedCityId}
            onDefect={(g) => setModal({ kind: 'defect', target: g })}
            onTransfer={(g) => setModal({ kind: 'transfer', general: g })}
          />
        </div>
      </FloatingPanel>

      <FloatingPanel position="left-3 bottom-3" title={t('news.heading')} bodyClass="w-80 max-h-[46vh]">
        <WorldNewsFeed game={game} />
      </FloatingPanel>

      <FloatingPanel position="right-3 bottom-3" align="right" title={t('faction.rankHeading')} bodyClass="w-80 max-h-[62vh]">
        <FactionPanel game={game} />
      </FloatingPanel>

      {/* On-map action buttons when a friendly city is selected; otherwise a hint. */}
      {modal.kind === 'none' && selectedCity && selectedCity.factionId === game.playerFactionId && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          <button className="btn btn-primary" onClick={openBuildForSelected}>
            {t('menu.internalAffairs')}
          </button>
          <button className="btn" onClick={openAttackForSelected}>
            {t('menu.attack')}
          </button>
          <button className="btn btn-ghost" onClick={() => endTurn()}>
            {t('menu.endTurn')} (n)
          </button>
        </div>
      )}
      {modal.kind === 'none' && !selectedCity && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded bg-parchment-100/90 px-3 py-1 text-xs text-ink-600 shadow-sm">
          {t('help.select')}
        </div>
      )}

      {modal.kind === 'menu' && (
        <CommandMenu
          title="menu.heading"
          options={[
            { id: 'build', label: 'menu.internalAffairs', hint: 'b' },
            { id: 'attack', label: 'menu.military', hint: 'a' },
            { id: 'save', label: 'menu.saveLoad', hint: 's' },
            { id: 'help', label: 'menu.help', hint: '?' },
            { id: 'end', label: 'menu.endTurn', hint: 'n' },
          ]}
          onCancel={() => setModal({ kind: 'none' })}
          onSelect={(id) => {
            setModal({ kind: 'none' });
            if (id === 'build') openBuildForSelected();
            else if (id === 'attack') openAttackForSelected();
            else if (id === 'save') setScreen({ kind: 'save' });
            else if (id === 'help') setModal({ kind: 'help' });
            else if (id === 'end') endTurn();
          }}
        />
      )}

      {modal.kind === 'internalAffairs' && (
        <InternalAffairs
          game={game}
          city={modal.city}
          onClose={() => setModal({ kind: 'none' })}
          onScheduled={(kind, days) => {
            setModal({
              kind: 'info',
              title: t(`menu.${kind}` as const),
              body: (
                <p>
                  {t('op.scheduled', {
                    days,
                    city: game.cities[modal.city.id]?.name ?? { zh: '?', en: '?' },
                  })}
                </p>
              ),
            });
          }}
        />
      )}

      {modal.kind === 'attackTarget' && (
        <AttackTarget
          from={modal.from}
          targets={modal.targets}
          onClose={() => setModal({ kind: 'none' })}
          onPick={(target) =>
            setModal({ kind: 'attackComposer', from: modal.from, target })
          }
        />
      )}

      {modal.kind === 'attackComposer' && (
        <AttackComposer
          game={game}
          from={modal.from}
          target={modal.target}
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={(generalIds, troops) => {
            schedulePlayer({
              kind: 'attack',
              fromCityId: modal.from.id,
              toCityId: modal.target.id,
              generalIds,
              troops,
            });
            // The march op is now in flight — close the modal so the
            // player can watch it crawl across the map.
            setModal({ kind: 'none' });
          }}
        />
      )}

      {modal.kind === 'actionResult' && (
        <ActionResult data={modal.data} onClose={() => setModal({ kind: 'none' })} />
      )}

      {modal.kind === 'defect' && (
        <DefectDialog
          game={game}
          target={modal.target}
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={(origin, cost) => {
            const beforeOrigin = game.cities[origin.id];
            const cmd: StrategicCommand = {
              kind: 'defect',
              fromCityId: origin.id,
              targetGeneralId: modal.target.id,
              gold: cost,
            };
            dispatchPlayer(cmd);
            const after = gameStore.getState().game;
            const afterTarget = after?.generals[modal.target.id];
            const afterOrigin = after?.cities[origin.id];
            const ok = afterTarget?.factionId === game.playerFactionId;
            if (ok && afterOrigin && beforeOrigin) {
              const deltas: StatDelta[] = [
                {
                  label: t('status.money'),
                  before: beforeOrigin.money,
                  after: afterOrigin.money,
                  negative: true,
                },
              ];
              setModal({
                kind: 'actionResult',
                data: {
                  kind: 'search', // closest available kind for reuse
                  city: origin,
                  general: null,
                  deltas,
                  found: modal.target.name,
                },
              });
            } else {
              setModal({
                kind: 'info',
                title: t('defect.title'),
                body: <p>{t('defect.failed', { reason: '—' })}</p>,
              });
            }
          }}
        />
      )}

      {modal.kind === 'transfer' && (
        <TransferDialog
          game={game}
          general={modal.general}
          onClose={() => setModal({ kind: 'none' })}
          onConfirm={(origin, destination, troops) => {
            const cmd: StrategicCommand = {
              kind: 'move',
              fromCityId: origin.id,
              toCityId: destination.id,
              generalIds: [modal.general.id],
              troops,
            };
            dispatchPlayer(cmd);
            setModal({
              kind: 'info',
              title: t('transfer.title'),
              body: (
                <p>
                  {t('transfer.done', {
                    general: modal.general.name,
                    city: destination.name,
                  })}
                </p>
              ),
            });
          }}
        />
      )}

      {modal.kind === 'help' && (
        <Dialog title={t('help.heading')} onClose={() => setModal({ kind: 'none' })}>
          <ul className="space-y-1 text-sm">
            <li>{t('help.select')}</li>
            <li>{t('help.move')}</li>
            <li>{t('help.endTurn')}</li>
            <li>{t('help.menu')}</li>
            <li>{t('help.build')}</li>
            <li>{t('help.attack')}</li>
            <li>{t('help.save')}</li>
            <li>{t('help.load')}</li>
            <li>{t('help.lang')}</li>
            <li>{t('help.inspect')}</li>
          </ul>
        </Dialog>
      )}

      {modal.kind === 'info' && (
        <Dialog title={modal.title} onClose={() => setModal({ kind: 'none' })}>
          {modal.body}
        </Dialog>
      )}
      <TurnDigest entries={turnDigest} onDismiss={dismissTurnDigest} />
    </div>
  );
};

// ---------------------------------------------------------------- submodals

const InternalAffairs: React.FC<{
  game: GameState;
  city: City;
  onClose: () => void;
  // Reports back the scheduled op type + duration so MainScreen can
  // surface a "command queued" toast. The actual effect lands when the
  // op completes via tickDays.
  onScheduled: (kind: 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit', days: number) => void;
}> = ({ game, city, onClose, onScheduled }) => {
  const generals = factionGenerals(game, game.playerFactionId).filter(
    (g) => g.locationCityId === city.id,
  );
  const governor = generals.sort((a, b) => b.stats.zheng - a.stats.zheng)[0];
  const options: MenuOption[] = [
    { id: 'develop', label: 'menu.develop' },
    { id: 'commerce', label: 'menu.commerce' },
    { id: 'govern', label: 'menu.govern' },
    { id: 'patrol', label: 'menu.patrol' },
    { id: 'search', label: 'menu.search' },
    { id: 'recruit', label: 'menu.recruit' },
  ];
  return (
    <CommandMenu
      title={`${t('menu.internalAffairs')} · ${pickName(city.name)}`}
      options={options}
      onCancel={onClose}
      onSelect={(id) => {
        if (!governor && id !== 'recruit') {
          onClose();
          return;
        }
        const kind = id as 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit';
        if (kind === 'recruit') {
          schedulePlayer({ kind: 'recruit', cityId: city.id, count: 1500 });
          onScheduled(kind, OP_DAYS.recruit);
        } else if (governor) {
          schedulePlayer({ kind, cityId: city.id, generalId: governor.id });
          onScheduled(kind, OP_DAYS[kind]);
        } else {
          onClose();
        }
      }}
    />
  );
};

// Mirror of OP_DURATION_DAYS in engine/pendingOp.ts — kept here purely
// to drive the "scheduled" toast text. If you tune the engine table
// remember to bump this too.
const OP_DAYS = {
  develop: 14,
  commerce: 14,
  govern: 10,
  patrol: 7,
  search: 21,
  recruit: 14,
} as const;

const AttackTarget: React.FC<{
  from: City;
  targets: City[];
  onClose: () => void;
  // Picks a target and hands off to the composer dialog. No engine
  // command is issued at this stage.
  onPick: (target: City) => void;
}> = ({ from, targets, onClose, onPick }) => {
  const options: MenuOption[] = targets.map((c) => ({
    id: c.id,
    label: `${pickName(c.name)}  (${c.garrison.toLocaleString()})`,
  }));
  return (
    <CommandMenu
      title={`${t('menu.attack')} · ${pickName(from.name)} →`}
      options={options}
      onCancel={onClose}
      onSelect={(targetId) => {
        const target = targets.find((c) => c.id === targetId);
        if (target) onPick(target);
        else onClose();
      }}
    />
  );
};

// Two-step attack flow: target picked, now choose which generals march
// and how many troops they bring. The march op is scheduled on confirm
// and ticks down via tickDays as the player advances time.
const AttackComposer: React.FC<{
  game: GameState;
  from: City;
  target: City;
  onClose: () => void;
  onConfirm: (generalIds: string[], troops: number) => void;
}> = ({ game, from, target, onClose, onConfirm }) => {
  const stationedGenerals = factionGenerals(game, game.playerFactionId).filter(
    (g) => g.locationCityId === from.id && g.status === 'active',
  );
  // Default: pre-select the two strongest combatants.
  const defaults = [...stationedGenerals]
    .sort((a, b) => b.stats.wu + b.stats.tong - (a.stats.wu + a.stats.tong))
    .slice(0, 2)
    .map((g) => g.id);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(defaults));
  const maxTroops = Math.max(0, from.garrison - 1000); // keep 1000 home garrison
  const defaultTroops = Math.min(maxTroops, 6000);
  const [troops, setTroops] = useState(defaultTroops);

  const canConfirm = selectedIds.size > 0 && troops > 0 && troops <= maxTroops;
  // Single source of truth for march timing: the engine's marchDuration
  // (grid-scale-aware). Avoids a duplicate inline calc drifting from the engine.
  const marchDays = marchDuration(from, target);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && canConfirm) {
        e.preventDefault();
        onConfirm([...selectedIds], troops);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onConfirm, selectedIds, troops, canConfirm]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
      <div className="panel w-[min(34rem,92vw)] max-h-[88vh] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">
            {t('menu.attack')} · {pickName(from.name)} → {pickName(target.name)}
          </h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ink-divider my-2" />

        <div className="text-xs text-ink-500">{t('battle.generals')}</div>
        {stationedGenerals.length === 0 ? (
          <div className="text-sm italic text-ink-500">{t('battle.noGenerals')}</div>
        ) : (
          <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {stationedGenerals.map((g) => {
              const checked = selectedIds.has(g.id);
              return (
                <li key={g.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1.5 text-sm ${
                      checked
                        ? 'border-seal-500 bg-seal-500/10'
                        : 'border-ink-300/40 bg-parchment-50/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-seal-500"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(g.id);
                          else next.delete(g.id);
                          setSelectedIds(next);
                        }}
                      />
                      <span className="font-serif">{pickName(g.name)}</span>
                    </span>
                    <span className="font-mono text-[11px] text-ink-500">
                      W{g.stats.wu}/C{g.stats.tong}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="text-ink-500">{t('transfer.troops')}</span>
            <input
              type="range"
              className="flex-1 accent-seal-500"
              min={0}
              max={maxTroops}
              step={100}
              value={troops}
              onChange={(e) => setTroops(Number(e.target.value))}
            />
            <span className="w-20 text-right font-mono text-sm tabular-nums">
              {troops.toLocaleString()}
            </span>
          </label>
          <div className="mt-1 text-[11px] text-ink-500">
            {t('battle.from')}: {pickName(from.name)} · {t('sidebar.garrison')}:{' '}
            {from.garrison.toLocaleString()} · 行军 ≈ {marchDays} 天
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t('app.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={() => onConfirm([...selectedIds], troops)}
          >
            {t('app.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------- spatial nav helper

// Pick the next city in a compass direction from `from`. We score every
// other city by:
//   - "axis distance": how aligned it is with the requested direction
//   - "lateral distance": how far off the perpendicular axis it sits
// The candidate with the smallest weighted distance, that also lies strictly
// in the requested direction, wins. Falls back to the geometrically closest
// city when no candidate is in that direction (so hjkl always moves _somewhere_).
function nextCityInDirection(
  from: City,
  all: City[],
  dir: 'up' | 'down' | 'left' | 'right',
): City | undefined {
  let best: { city: City; score: number } | undefined;
  let nearest: { city: City; score: number } | undefined;
  for (const c of all) {
    if (c.id === from.id) continue;
    const dx = c.pos.x - from.pos.x;
    const dy = c.pos.y - from.pos.y;
    const dist = Math.hypot(dx, dy);
    if (!nearest || dist < nearest.score) nearest = { city: c, score: dist };

    let axis = 0;
    let lateral = 0;
    switch (dir) {
      case 'left':
        if (dx >= 0) continue;
        axis = -dx;
        lateral = Math.abs(dy);
        break;
      case 'right':
        if (dx <= 0) continue;
        axis = dx;
        lateral = Math.abs(dy);
        break;
      case 'up':
        if (dy >= 0) continue;
        axis = -dy;
        lateral = Math.abs(dx);
        break;
      case 'down':
        if (dy <= 0) continue;
        axis = dy;
        lateral = Math.abs(dx);
        break;
    }
    // Penalize off-axis distance more heavily so hjkl feels predictable.
    const score = axis + lateral * 1.8;
    if (!best || score < best.score) best = { city: c, score };
  }
  return (best ?? nearest)?.city;
}
