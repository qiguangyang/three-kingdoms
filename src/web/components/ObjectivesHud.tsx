import React from 'react';
import { FloatingPanel } from './FloatingPanel.js';
import { objectivesFor } from '../../engine/story/objectives.js';
import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, ObjectiveState } from '../../engine/story/types.js';
import { t } from '../../i18n/locale.js';

// A resolved objective ready to render: its runtime state joined with its
// static definition (the title/description message keys).
interface ResolvedObjective {
  state: ObjectiveState;
  def: ObjectiveDef;
}

// Compact "story-guided" HUD on the campaign map. Reads the runtime
// game.objectives, joins each against its ObjectiveDef (looked up by the
// active scenario + story mode), and lists the non-hidden ones — active
// objectives plain, completed ones marked with a check. Collapsed to a pill
// by default (FloatingPanel), matching the other floating map HUD badges.
export const ObjectivesHud: React.FC<{ game: GameState }> = ({ game }) => {
  const defs = objectivesFor(game.scenarioId, game.storyMode);
  const byId = new Map<string, ObjectiveDef>(defs.map((d) => [d.id, d]));
  const items: ResolvedObjective[] = [];
  for (const state of game.objectives) {
    const def = byId.get(state.id);
    // Skip objectives with no matching definition, and hidden ones (not
    // surfaced in the HUD until unlocked).
    if (!def || def.hidden) continue;
    items.push({ state, def });
  }
  // Nothing to guide the player with (e.g. Free Play with no objectives).
  if (items.length === 0) return null;
  const done = items.filter((it) => it.state.status === 'complete').length;
  return (
    <FloatingPanel
      // The objectives HUD is the Story-Mode guide — it only renders when there
      // are objectives (never in Free Play), so open it by default. The player
      // sees their goals the moment the map opens, and can still collapse it.
      defaultOpen
      position="left-1/2 top-3 -translate-x-1/2"
      bodyClass="w-80 max-h-[46vh]"
      title={
        <span className="flex items-center gap-1.5">
          <span aria-hidden>◈</span>
          <span>{t('objective.heading')}</span>
          <span className="font-mono text-[10px] text-ink-400">
            {done}/{items.length}
          </span>
        </span>
      }
    >
      <ul className="space-y-1 bg-parchment-100/95 p-2 text-sm">
        {items.map(({ state, def }) => {
          const complete = state.status === 'complete';
          return (
            <li key={def.id} className="flex items-start gap-2">
              <span className={complete ? 'text-seal-600' : 'text-ink-400'} aria-hidden>
                {complete ? '✓' : '○'}
              </span>
              <span className="flex flex-col">
                <span
                  className={
                    complete ? 'text-ink-500 line-through' : 'font-semibold text-ink-800'
                  }
                >
                  {t(def.titleKey)}
                </span>
                <span className="text-[11px] text-ink-500">{t(def.descKey)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </FloatingPanel>
  );
};
