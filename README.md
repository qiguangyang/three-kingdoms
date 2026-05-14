# Three Kingdoms

A browser-based turn-based strategy game set in the Three Kingdoms era (late
Eastern Han, 189 CE onward). Built with **React 19 + Vite + Tailwind**,
SVG-rendered map, zero external image assets — everything is procedurally
drawn or rendered as styled DOM.

> Inspired by the classic *Three Kingdoms Hegemony* (《三国霸业》) bundled with
> BBK electronic dictionaries in the late 1990s and early 2000s. This is a
> tribute / fan project — gameplay structure (four chapters, search-for-items,
> hidden generals, etc.) honors the spirit of the original, while all numerical
> data, general profiles, and city attributes are original designs based on the
> historical *Records of the Three Kingdoms* (《三国志》) and the novel
> *Romance of the Three Kingdoms* (《三国演义》).
>
> No code, art, or data from the original game is used.

## Install & Run

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # tsc + vite build → dist/
npm run preview      # preview the production build locally
npm test             # vitest suite (65 tests under jsdom)
```

## Visual style

Parchment cream backdrop with 印章-style faction seals on a scalable SVG map.
Logical coordinates are still 100 × 40 (data lives in `SCENARIOS.md`) but the
rendered map is fully zoomable / pannable — wheel to zoom, drag to pan, click
a city's seal to select it.

## Architecture

```
src/
├── engine/   pure logic, framework-free (runs in Node and in the browser)
├── data/     static TS data: cities, generals, terrain, scenarios, items
├── i18n/     bilingual catalogs (zh + en) and the locale store slice
├── state/    Zustand store, actions, localStorage persistence
└── web/      React DOM components, screens, hooks, SVG map renderer
```

- **Engine** is pure: `(state, args) => newState`. Save snapshots are JSON
  versions of `GameState` + an action log; replay is deterministic.
- **Data-driven**: every numerical value (general stats, city economy,
  terrain modifiers) lives in `src/data/`. The engine never hardcodes
  a number for any general or city.
- **Bilingual**: proper nouns carry both `zh` and `en`. The engine emits
  message keys; the UI resolves them in the active locale (toggle on screen
  or via `?lang=en` query param).
- **AI**: two layers (strategic monthly + tactical per-battlefield-day).
  The `FactionAgent` interface accepts any implementation — a default
  rule-based agent ships, and an LLM-backed agent can be slotted in at
  startup.

## Scenarios

| Id | Name | Year | Status |
| --- | --- | --- | --- |
| `s1-dongzhuo` | 董卓弄权 / Dong Zhuo's Tyranny | 189 | Implemented (15 factions, 40 cities) |
| `s2-junxiong` | 群雄逐鹿 / Heroes Contend | 196 | Stub |
| `s3-chibi` | 赤壁之战 / Battle of Red Cliffs | 208 | Stub |
| `s4-dingli` | 三国鼎立 / Tripartite Stalemate | 220 | Stub |

See [`SCENARIOS.md`](./SCENARIOS.md) for full design notes.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `n` / `Space` | End current month |
| `m` | Open command menu |
| `b` | Internal-affairs panel for selected city |
| `a` | Attack adjacent hostile city |
| `s` / `L` | Save / Load |
| `g` | Toggle language (zh / en) |
| `?` | Help overlay |

## License

MIT (TBD — tribute / fan project, non-commercial).
