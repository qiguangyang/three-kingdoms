import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { setInitialLocale } from '../state/store.js';
import './styles.css';

// Parse a couple of query-string conveniences:  ?lang=en   ?seed=42
// ?scenario=s1-dongzhuo&faction=caocao  — auto-starts the game.
const params = new URLSearchParams(window.location.search);
const lang = params.get('lang');
if (lang === 'en' || lang === 'zh') setInitialLocale(lang);

// ?battle=1 — DEV viewing aid: seed a field battle and jump straight to the
// battle screen. Picks an enemy city and gives its defenders real troops so
// both sides deploy armies (a proper engagement, not a walled-garrison
// standoff). Gated behind the query param — inert during normal play.
if (params.get('battle')) {
  void (async () => {
    const { buildInitialState } = await import('../engine/scenario.js');
    const { SCENARIO_DONGZHUO } = await import('../data/scenarios/s1-dongzhuo.js');
    const { REF_DATA } = await import('../data/index.js');
    const { createBattle } = await import('../engine/battle/setup.js');
    const { loadGame } = await import('../state/store.js');
    const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao' && c.generals.length >= 2);
    const home = Object.values(s.cities).find((c) => c.factionId === 'caocao' && c.generals.length > 0);
    if (!target || !home) { console.error('[devbattle] no suitable cities found'); return; }
    const generals = { ...s.generals };
    for (const gid of target.generals) generals[gid] = { ...generals[gid]!, troops: 5000 };
    const game = { ...s, generals };
    const battle = createBattle(game, {
      cityId: target.id,
      attackerFactionId: 'caocao',
      defenderFactionId: target.factionId!,
      attackingGeneralIds: home.generals.slice(0, 3),
      attackingTroops: 24000,
    });
    loadGame({ game: { ...game, pendingBattle: battle }, locale: lang === 'en' ? 'en' : 'zh' });
  })();
}

const mount = document.getElementById('root');
if (!mount) throw new Error('Missing #root container in index.html');
createRoot(mount).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
