// A pure per-day read of the battlefield from one side's perspective. Feeds
// the planner: troop balance, available reserves, and a focus-fire target.
import type { Battle, BattleUnit, FactionId } from '../../types.js';

export interface Assessment {
  myFielded: number; // my total fielded troops
  enemyFielded: number; // enemy total fielded troops
  advantage: number; // myFielded / max(enemyFielded, 1)
  reserveUnitIds: string[]; // my units in state 'reserve'
  priorityTargetId: string | null; // weakest active enemy unit id (finish it)
}

const isFielded = (x: BattleUnit): boolean => x.state === 'fielded' && x.troops > 0;

export function assessBattle(battle: Battle, factionId: FactionId): Assessment {
  let myFielded = 0;
  let enemyFielded = 0;
  const reserveUnitIds: string[] = [];
  let target: BattleUnit | null = null;
  for (const un of battle.units) {
    const mine = un.factionId === factionId;
    if (mine && un.state === 'reserve') reserveUnitIds.push(un.id);
    if (!isFielded(un)) continue;
    if (mine) {
      myFielded += un.troops;
    } else {
      enemyFielded += un.troops;
      if (!target || un.troops < target.troops) target = un;
    }
  }
  return {
    myFielded,
    enemyFielded,
    advantage: myFielded / Math.max(enemyFielded, 1),
    reserveUnitIds,
    priorityTargetId: target ? target.id : null,
  };
}
