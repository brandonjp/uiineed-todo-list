# Sort-as-view + working drag-to-reorder — design

Date: 2026-06-18
Status: Approved (pending spec review)
Target version: 1.7.0 (feature)

## Problem

Two gaps in the current todo app (`public/js/app.js`, `index.html`):

1. **Drag-to-reorder does nothing on desktop/laptop.** The list lives in a keyed
   `<transition-group>`. Reordering is done by live-splicing `this.todos` on every
   `@dragenter`. When the group FLIP-moves the dragged `<li>` mid-drag, the browser
   aborts the native HTML5 drag, so the reorder never lands.

2. **No way to know the current sort, and no way back to a manual order.**
   `sortBy()` *replaces* `this.todos` (destructive, and it even syncs the reorder to
   other devices). There is no separate "custom/manual order" to return to, and the
   single "⇅ Sort" button never shows which mode is active. After Shuffle / A–Z /
   Newest, the user can't tell what they're looking at or how to get back.

## Goals

- Sorting is a **non-destructive view** over a preserved manual order.
- The user always knows the active sort, and can return to their manual order at any time.
- Dragging an item (in any view) defines/updates the manual order and switches to it.
- Drag-to-reorder actually works on desktop and continues to work on touch.

## Non-goals

- Undo/redo for shuffle or reorder (YAGNI).
- Per-view independent sort modes — sort mode is global, applied to whatever list is shown.
- Reordering inside filtered subsets — drag stays `'all'`-view-only, as today.
- Syncing the sort/view preference across devices — it's a per-device view preference.

## Core model

`todos` (the existing array) **is** the user's manual / custom order. No sort ever
mutates it. The displayed order is a computed lens on top of it.

New state: `sortMode ∈ { 'custom', 'az', 'za', 'newest', 'oldest', 'random' }`,
default `'custom'`.

```
displayTodos (computed) = lens(filteredTodos, sortMode)
  custom              -> filteredTodos as-is (identity)
  az/za/newest/oldest -> sortTodos(filteredTodos, mode)   // existing pure helper, deterministic
  random              -> filteredTodos ordered by stored randomOrder (see below)
```

The list `v-for` renders `displayTodos` instead of `filteredTodos`.

### Why random needs a stored order

`az/za/newest/oldest` are pure functions of the data, so recomputing on any re-render
(toggle complete, edit title, add item) yields the identical order — stable and
invisible. Random is not a function of the data; recomputing would call `Math.random()`
again and visibly re-shuffle on every keystroke. So the shuffle is rolled **once** at
click time and the resulting order is stored; the lens reads from that stored order.
This makes Shuffle behave exactly like the other sorts — a stable, non-outlier view.

`randomOrder` is an array of todo **ids** in shuffled sequence.
- Lens for `random`: order `filteredTodos` by each item's index in `randomOrder`.
- Ids in `filteredTodos` but **not** in `randomOrder` (e.g. a task added after the
  shuffle) sort to the **top**, preserving their existing relative order. This matches
  the app's "newest at top" convention (adds `unshift`).
- Ids in `randomOrder` no longer present are simply ignored.
- Clicking Shuffle again re-rolls `randomOrder` from the current todo ids.

## Dragging defines manual order

Manual reorder is the single source of "custom order":

- On **drag start**, if `sortMode !== 'custom'`, bake the current visible order into the
  data and switch to manual *before* the move: `this.todos = displayTodos.slice()` (for
  the `'all'` view, where reorder is allowed, `filteredTodos === todos`), then
  `this.sortMode = 'custom'`. The visible order is unchanged at this instant; the user's
  drag then operates on a stable manual array whose indices line up 1:1 with the rendered
  list.
- The move itself uses the existing `moveItem(from, to)` against `this.todos`.
- Result: any manual move saves the manual order, and the sort indicator flips to
  **Manual** as immediate feedback that a new manual order was committed.

### Fixing the broken desktop drag

Live-splicing on `@dragenter` is what aborts the native drag. Reimplement so the native
drag survives to completion:

- Track a target index during the gesture and **commit the reorder on `@dragend`/`@drop`**,
  rather than mutating the list on every `dragenter`. (Implementation may instead keep
  live reorder but suppress the transition-group's move animation while a drag is active —
  whichever the plan finds reliable. The hard requirement: a desktop drag must visibly
  reorder and persist, verified manually.)
- `@dragover` must keep calling `preventDefault()` so the item is a valid drop target.
- Touch reorder already works (it uses `elementFromPoint`, not native HTML5 drag); keep it,
  routing it through the same "bake to manual on start" logic.

## Indicator UX

The user always sees the active mode and can return to manual.

1. **Sort button label** reflects the mode: `⇅ Manual`, `⇅ A–Z`, `⇅ Z–A`, `⇅ Newest`,
   `⇅ Oldest`, `⇅ Shuffled` (new `currentSortLabel` computed).
2. **Sort menu** gains a **Manual order** entry at the top and a ✓ / `active` class on the
   active mode (reuse the existing `active` highlight pattern). "Manual order" is enabled
   whenever `sortMode !== 'custom'` and is the explicit way back to custom order.

```
  Sort by
  ─────────────────
  ✓ Manual order        <- active when sortMode === 'custom'; the way back to custom
    A → Z
    Z → A
    Newest first
    Oldest first
  ─────────────────
  🔀 Shuffle            <- rolls a fresh random view; re-roll by clicking again
```

## Behavior of existing sort actions

- `sortBy(mode)` for `az/za/newest/oldest`: set `this.sortMode = mode` (do **not** mutate
  `this.todos`), close the menu.
- Shuffle: roll `randomOrder` from current todo ids, set `this.sortMode = 'random'`,
  close the menu.
- New `setManual()` / `sortBy('custom')`: set `this.sortMode = 'custom'`.

## Data model & persistence

- New local key `uiineed-sort` storing `{ mode, randomOrder }`. **Local only** (not synced),
  like the existing `uiineed-filter` (`FILTER_KEY`).
- A `sortMode` watcher persists the preference (mirrors the `intention` watcher).
- On load, restore `sortMode`/`randomOrder`. If `mode === 'random'` but `randomOrder` is
  empty/stale, fall back to `'custom'` (or lazily re-roll on first render).
- `todos` continues to persist + sync exactly as today. Side benefit: because sorting no
  longer mutates `todos`, choosing a sort on one device no longer reorders the others.

## Edge cases

- **Add while sorted (deterministic):** new item slots in by the sort rule automatically
  (lens recomputes). No special handling.
- **Add while shuffled:** new item appears at the **top** until the next shuffle (see lens).
- **Complete/remove/restore while sorted:** mutate `todos` as today; the lens recomputes.
- **Filtered views (ongoing/completed):** the sort lens applies to the displayed subset;
  drag-reorder remains disabled outside `'all'` (existing `moveItem` guard).
- **< 2 todos:** sort bar stays hidden (`v-if="todos.length > 1"`), as today.

## i18n

Add keys in both `en` and `zh` blocks of `public/js/i18n.js`:
- `sortManual` ("Manual order" / e.g. "手动排序")
- Short labels for the button if not reusing existing strings: `sortLabelManual`,
  `sortLabelAZ`, `sortLabelZA`, `sortLabelNewest`, `sortLabelOldest`, `sortLabelRandom`
  (or derive from existing `sortAZ` etc. — implementer's choice, keep both languages in sync).

## Files touched

- `public/js/app.js` — `sortMode`/`randomOrder` state + persistence + watcher; `displayTodos`
  computed; `currentSortLabel` computed; rewrite `sortBy`/add `setManual`; rewrite drag
  commit path (`dragstart`/`dragenter`/`dragover`/`dragend`/`drop` + touch routing);
  `APP_VERSION` bump.
- `index.html` — `v-for` over `displayTodos`; dynamic sort-button label; "Manual order" +
  active state in the sort menu; cache-bust query strings; `<meta name="version">`.
- `index-zh.html` — mirror the markup/version changes.
- `public/js/i18n.js` — new sort keys (en + zh), bump `?v=`.
- `CHANGELOG.md`, `README.md` — release notes / current-version line.

## Testing

- **Manual (required):** desktop drag visibly reorders and persists across reload; touch
  drag still works; each sort mode renders the right order; button label + menu ✓ track the
  active mode; "Manual order" restores the pre-sort custom order untouched; Shuffle is
  stable across edits and re-rolls on second click; new task lands at top while shuffled;
  switching sort on one device does not reorder another synced device.
- Lens helpers (`displayTodos` random ordering, new-id-to-top rule) are pure and unit-testable
  if a harness fits the existing `test/` setup.

## Version

Feature → bump `1.6.4` → **`1.7.0`** in `app.js` `APP_VERSION`, `index.html`/`index-zh.html`
`<meta>` + asset `?v=`, `i18n.js` `?v=`, README current-version line, and a CHANGELOG entry.
