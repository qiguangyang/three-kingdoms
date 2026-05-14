import type { Item } from '../../engine/types.js';

// Weapons (神兵). Equippable by generals; modifier scales melee damage.
const WEAPONS: Item[] = [
  {
    id: 'yitian',
    kind: 'weapon',
    name: { zh: '倚天剑', en: 'Yitian Sword' },
    bonus: { wu: 5 },
    modifier: 1.15,
  },
  {
    id: 'qinggang',
    kind: 'weapon',
    name: { zh: '青虹剑', en: 'Qinggang Sword' },
    bonus: { wu: 5 },
    modifier: 1.15,
  },
  {
    id: 'fangtian',
    kind: 'weapon',
    name: { zh: '方天画戟', en: 'Fangtian Halberd' },
    bonus: { wu: 8 },
    modifier: 1.25,
  },
  {
    id: 'shuanggu',
    kind: 'weapon',
    name: { zh: '双股剑', en: 'Twin Swords' },
    bonus: { wu: 4 },
    modifier: 1.1,
  },
  {
    id: 'gudian',
    kind: 'weapon',
    name: { zh: '古淀刀', en: 'Gudian Saber' },
    bonus: { wu: 4 },
    modifier: 1.1,
  },
  {
    id: 'shuangtie',
    kind: 'weapon',
    name: { zh: '双铁戟', en: 'Twin Iron Halberds' },
    bonus: { wu: 6 },
    modifier: 1.15,
  },
  {
    id: 'sanjian',
    kind: 'weapon',
    name: { zh: '三尖刀', en: 'Three-Pointed Blade' },
    bonus: { wu: 5 },
    modifier: 1.12,
  },
  {
    id: 'qixing',
    kind: 'weapon',
    name: { zh: '七星刀', en: 'Seven-Star Saber' },
    bonus: { wu: 5 },
    modifier: 1.12,
  },
];

// Horses (宝马).
const HORSES: Item[] = [
  { id: 'chitu',     kind: 'horse', name: { zh: '赤兔', en: 'Red Hare' },          bonus: { wu: 5, tong: 5 }, modifier: 1.3 },
  { id: 'dilu',      kind: 'horse', name: { zh: '的卢', en: 'Dilu' },              bonus: { wu: 3, tong: 4 }, modifier: 1.2 },
  { id: 'jueying',   kind: 'horse', name: { zh: '绝影', en: 'Jueying' },           bonus: { wu: 3, tong: 4 }, modifier: 1.2 },
  { id: 'zhuahuang', kind: 'horse', name: { zh: '爪黄飞电', en: 'Zhuahuang' },     bonus: { wu: 3, tong: 4 }, modifier: 1.2 },
];

// Books (兵书).
const BOOKS: Item[] = [
  { id: 'sunzi',    kind: 'book', name: { zh: '孙子兵法',   en: 'Art of War (Sun Zi)' },        bonus: { zhi: 8, tong: 4 } },
  { id: 'sunbin',   kind: 'book', name: { zh: '孙膑兵法',   en: 'Sun Bin Bingfa' },             bonus: { zhi: 6, tong: 4 } },
  { id: 'wuzi',     kind: 'book', name: { zh: '吴子兵法',   en: 'Wu Zi Bingfa' },               bonus: { zhi: 5, tong: 5 } },
  { id: 'liutao',   kind: 'book', name: { zh: '六韬',       en: 'Liu Tao' },                    bonus: { zhi: 6, zheng: 4 } },
  { id: 'sanlue',   kind: 'book', name: { zh: '三略',       en: 'San Lue' },                    bonus: { zhi: 5, zheng: 5 } },
  { id: 'weiliaozi',kind: 'book', name: { zh: '尉缭子',     en: 'Wei Liaozi' },                 bonus: { tong: 6, zhi: 3 } },
  { id: 'mozi',     kind: 'book', name: { zh: '墨子',       en: 'Mo Zi' },                      bonus: { zheng: 8 } },
  { id: 'shangjun', kind: 'book', name: { zh: '商君书',     en: 'Shang Jun Shu' },              bonus: { zheng: 8 } },
  { id: 'fanli',    kind: 'book', name: { zh: '范蠡兵法',   en: 'Fan Li Bingfa' },              bonus: { zhi: 5, zheng: 5 } },
  { id: 'guiguzi',  kind: 'book', name: { zh: '鬼谷子',     en: 'Guiguzi' },                    bonus: { zhi: 8 } },
  { id: 'simafa',   kind: 'book', name: { zh: '司马法',     en: 'Sima Fa' },                    bonus: { tong: 8 } },
];

// Tokens (兵符) — unlock special troop types.
const TOKENS: Item[] = [
  { id: 'taixuan', kind: 'token', name: { zh: '太玄兵符', en: 'Taixuan Token' }, bonus: {}, unlocks: ['xuan'] },
  { id: 'tieqi',   kind: 'token', name: { zh: '铁骑兵符', en: 'Iron Cavalry Token' }, bonus: {}, unlocks: ['heavyCav'] },
  { id: 'shuizhan',kind: 'token', name: { zh: '水战兵符', en: 'Naval Token' }, bonus: {}, unlocks: ['navy'] },
  { id: 'jingfan', kind: 'token', name: { zh: '惊帆', en: 'Jingfan Sail' }, bonus: { tong: 3 } },
  { id: 'kuaihang',kind: 'token', name: { zh: '快航', en: 'Swift Sail' }, bonus: { tong: 3 } },
];

const ALL: Item[] = [...WEAPONS, ...HORSES, ...BOOKS, ...TOKENS];

export const ITEMS: Record<string, Item> = Object.fromEntries(ALL.map((it) => [it.id, it]));
