// Terrain palette and faction lookups, sourced once and used by both the
// SVG map renderer and the legend / sidebar.

import type { Terrain } from '../engine/types.js';

export const TERRAIN_FILL: Record<Terrain, string> = {
  plain: '#ead7a0',
  mountain: '#b4a37b',
  forest: '#8fa37a',
  river: '#7fa9c1',
  city: '#f3e9cf',
};

// Darker stroke for terrain region outlines (subtle ink).
export const TERRAIN_STROKE: Record<Terrain, string> = {
  plain: '#d9c283',
  mountain: '#8a7a52',
  forest: '#637a4d',
  river: '#5a85a0',
  city: '#c3b176',
};

export const FACTION_COLOR: Record<string, string> = {
  dongzhuo: '#7d1a1a',
  yuanshao: '#264a8a',
  caocao: '#6b1f7d',
  gongsunzan: '#7a6a4a',
  liubei: '#2f6b3a',
  sunjian: '#1f6a7a',
  liubiao: '#a07a2c',
  liuyan: '#386a78',
  mahan: '#a64225',
  taoqian: '#8a6a18',
  kongrong: '#8a3a76',
  yuanshu: '#3a7a4a',
  liuyu: '#6a6e6a',
  zhanglu: '#b0a070',
  gongsundu: '#34526e',
  __neutral__: '#94876a',
};

export function factionColor(id: string | null | undefined): string {
  if (!id) return FACTION_COLOR.__neutral__ as string;
  return FACTION_COLOR[id] ?? '#3d3324';
}

// One-character glyph for a faction's stamp/印章. Defaults to the first hanzi
// of the faction name if no explicit glyph is registered.
export const FACTION_GLYPH: Record<string, string> = {
  dongzhuo: '董',
  yuanshao: '袁',
  caocao: '曹',
  gongsunzan: '瓒',
  liubei: '刘',
  sunjian: '孙',
  liubiao: '表',
  liuyan: '焉',
  mahan: '马',
  taoqian: '陶',
  kongrong: '孔',
  yuanshu: '术',
  liuyu: '虞',
  zhanglu: '鲁',
  gongsundu: '度',
  __neutral__: '·',
};
