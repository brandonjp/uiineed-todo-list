# In-View Task Search — Design

**Date:** 2026-06-29
**Branch:** `feature/in-view-task-search`
**Status:** Approved design, pending implementation plan

## Goal

Let the user type to filter the currently displayed task list down to tasks whose
title matches the typed text, so they can quickly find a specific task.

## Key decision: search narrows only the current view

Search filters **only what is currently displayed** (the active tab + sort lens). It
never surfaces hidden, completed, or trashed tasks that aren't in the current view. If
the user wants to search completed or trash items, they switch to that view first and
search there. This keeps the mental model simple and predictable: "search filters what
I'm looking at."

## Placement

A compact search input lives in the right floating toolbar (`.todo-footer-box` inside
`.footer.side-bar`), as the **first element, above the filter tabs**. Top-to-bottom the
toolbar then reads: **Search → Tabs (All/Ongoing/Completed/Trash) → Sort → context
actions → more/palette**. All "what am I looking at" controls are grouped together.

- The search input is only rendered when there is something to search
  (`todos.length > 0`), matching how `sort-bar` only shows when `todos.length > 1`.
- The slogan bar ("Act Now, Simplify Life.☕") is intentionally **left alone** — it is a
  personal motto with double-click-to-edit, and overloading it with search would create
  a click/double-click conflict.

## Data flow

Current chain (in `public/js/app.js` computed properties):

```
todos → filteredTodos (by intention tab) → displayTodos (by sort mode) → rendered
```

New chain inserts one text-filter layer:

```
todos → filteredTodos (tab) → searchedTodos (text) → displayTodos (sort) → rendered
```

- `displayTodos` changes its source from `this.filteredTodos` to `this.searchedTodos`.
- `searchedTodos` returns `filteredTodos` unchanged when the query is empty/whitespace,
  otherwise a `.filter()` on `title`.

### Matching rule

- Case-insensitive substring match.
- Query is trimmed of leading/trailing whitespace; an empty/whitespace-only query
  disables filtering (passes everything through).
- Matches `title` only. (A todo object is `{ id, title, completed, removed, createdAt }`
  — `title` is the only text field, so there is nothing else to match.)

## State

- New data field `searchQuery: ''`.
- **Not** persisted to `localStorage` — it is transient view state and resets on reload.
  (Contrast with `intention`/sort, which persist.)
- **Persists across tab switches** within a session: switching Ongoing→Completed
  re-filters the new view with the same term. It still only ever narrows the current
  view, never reveals out-of-view items.

## Interaction details

- **Clear button:** an inline `×` button appears inside/beside the input when
  `searchQuery` is non-empty; clicking it clears the query and refocuses the input.
- **Keyboard:** `/` focuses the search input (ignored when focus is already in a text
  input/textarea, so it won't hijack normal typing). `Esc` while focused clears the
  query and blurs.
- **No matches:** when a query is active and `searchedTodos` is empty, show a localized
  "No tasks match "<query>"" message in the existing empty-state region, with a
  "Clear search" affordance. This is distinct from the existing "no tasks at all"
  empty-tips state.

## Edge cases

- **Drag-to-reorder while searching:** disabled while `searchQuery` is non-empty, the
  same way the Trash (`removed`) view already disables reordering. Reordering a
  text-narrowed subset is ambiguous; requiring the user to clear search first is
  cleaner. (Implementation: the existing drag guards already early-return for
  `intention === 'removed'`; add an equivalent guard for an active search query.)
- **Tab badges:** the per-tab count badges (All/Ongoing/Completed/Trash) continue to
  show totals for each tab and are **not** rewritten by search.
- **Sort + search compose:** sort applies after search (search narrows, sort orders the
  narrowed set), because `displayTodos` sorts `searchedTodos`.

## i18n

Add the following keys to `public/js/i18n.js` for both `en` and `zh` locales (so
`index.html` and `index-zh.html` both pick them up):

- `searchPlaceholder` — input placeholder, e.g. "Search tasks…"
- `searchClear` — clear-button aria/title, e.g. "Clear search"
- `searchNoMatch` — no-results message; supports the query, e.g. `No tasks match “{q}”`
  (use the existing `tf()` interpolation helper).

## Out of scope (YAGNI)

- Match highlighting within task rows.
- Fuzzy / regex matching.
- Searching across all views simultaneously.
- A cross-tab "N matches in other tabs" hint. (Acceptable as a future optional
  enhancement, but explicitly not part of v1 — it edges toward surfacing out-of-view
  results, which the core decision avoids.)

## Files touched

- `index.html` — add search input markup in `.todo-footer-box`; add no-match empty
  state; (optionally) version-string bumps.
- `index-zh.html` — mirror the same markup.
- `public/js/app.js` — `searchQuery` data field; `searchedTodos` computed; repoint
  `displayTodos`; `/` and `Esc` key handling; clear method; drag guards for active
  search.
- `public/js/i18n.js` — new keys for `en` and `zh`.
- `CHANGELOG.md`, `README.md`, version constants — per release conventions.

## Testing

- Manual: typing narrows the visible list; clearing restores it; `/` focuses; `Esc`
  clears; no-match message shows and its clear link works; switching tabs re-filters;
  drag disabled while searching; search hidden when there are zero tasks.
- If the existing `test/` harness covers computed filtering, add a `searchedTodos`
  case (empty query passthrough, case-insensitive match, no-match empty array).
