// Chapter registry: the ordered list of playable chapters per protagonist,
// mapping each chapter number to the scenario that hosts it.
//
// A Story-Mode campaign is a sequence of chapters. Winning one chapter bridges
// (via the "...years pass" transition) into the next chapter's scenario, freshly
// re-seeded. This registry is the single source of truth for that ordering, so
// startChapter (which builds a chapter) and outcomeScreen (which decides whether
// a win transitions or terminates) stay in agreement. Pure data + lookups; no
// wall-clock, no randomness.

import type { FactionId } from '../types.js';

export interface ChapterDef {
  chapter: number;
  scenarioId: string;
}

// Per-protagonist chapter arcs, in play order. Liu Bei's campaign runs
// Chapter 1 (董卓 / s1-dongzhuo) -> Chapter 2 (群雄逐鹿 / s2-junxiong) ->
// Chapter 3 (赤壁之战 / s3-chibi); later phases extend the array with Chapter 4+.
export const CHAPTERS: Record<FactionId, ChapterDef[]> = {
  liubei: [
    { chapter: 1, scenarioId: 's1-dongzhuo' },
    { chapter: 2, scenarioId: 's2-junxiong' },
    { chapter: 3, scenarioId: 's3-chibi' },
  ],
};

// The chapter following `chapter` in `protagonistId`'s arc, or undefined when
// `chapter` is the final chapter (or the protagonist has no registered arc).
export function nextChapter(protagonistId: FactionId, chapter: number): ChapterDef | undefined {
  const arc = CHAPTERS[protagonistId];
  if (!arc) return undefined;
  return arc.find((def) => def.chapter === chapter + 1);
}

// The scenario id hosting `chapter` of `protagonistId`'s arc, or undefined when
// there is no such chapter (unknown protagonist / out-of-range chapter).
export function chapterScenarioId(protagonistId: FactionId, chapter: number): string | undefined {
  const arc = CHAPTERS[protagonistId];
  if (!arc) return undefined;
  return arc.find((def) => def.chapter === chapter)?.scenarioId;
}
