// The WebGL detector moved to the shared src/web/gfx/hasWebGL.ts so the battle
// and campaign-map views gate on one implementation. Re-exported here so
// existing battle imports (BattleView, tests) keep working unchanged.
export { hasWebGL } from '../gfx/hasWebGL.js';
