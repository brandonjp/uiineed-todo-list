# Right-Side Menu UX Overhaul — Design

_Date: 2026-06-12 · Target release: **v1.2.0**_

## Problem

The right-side menu (`.todo-footer-box`) stacks **three button groups / up to 15 identical
`btn-small` controls** that mix three different mental models wearing the same uniform:

- **Filters** (All / In Progress / Completed / Trash) — *view state*, not actions.
- **Batch actions** (Finish All / Clear Completed / Clear All / Sort A–Z) — *do-something-now*.
- **Data drawer** (Settings / Add many / Export / Copy / Import / Paste / Reload) — a junk
  drawer mixing config, input, data-out, data-in, and a reload workaround.

Symptoms: no visual hierarchy (destructive "Clear All" looks as safe as "Settings");
`v-if` makes buttons appear/disappear as you work, so the menu length jumps around;
redundant surface (Export/Copy are one intent via two channels, same for Import/Paste).

## Goals

- Clever, calm UX that is easy, reliable, and **doesn't get in the way**.
- **Preserve the established framework and feel:** static / build-free, Vue 2, vendored,
  shared `app.js` + `i18n.js` loaded by both `index.html` (EN) and `index-zh.html` (ZH),
  `:root` CSS-variable theming, minimal and straightforward. No bundler, no new deps.
- Cut the always-visible control count from ~15 down to **4 tabs + 1 contextual slot + 1
  "More" button**, without losing any capability.

## Core architecture — one action registry, rendered three ways

A single computed `actions` array is the source of truth. Each entry:

```js
{ id, label, icon, section, danger, hint, when, run }
//  section ∈ 'organize' | 'cleanup' | 'data' | 'app'
//  when    → Boolean (availability, e.g. completedTodosCount > 0)
//  run     → calls an existing method (sortAZ, clearAll, exportFile, …)
```

The registry feeds **both** surfaces, so adding/removing a command is a one-line change:

1. **More menu** — groups available actions by `section`, destructive ones styled `danger`.
2. **Command palette** — flat, fuzzy-searchable list of the same available actions.

Existing methods (`sortAZ`, `markAllAsCompleted`, `clearCompleted`, `clearAll`,
`exportFile`, `copyToClipboard`, `importFile`, `pasteFromClipboard`, `openBulk`,
`openSettings`) are reused verbatim as the `run` handlers. No behavior change inside them.

## The four pieces

### 1. Filters → segmented tab control
Replace the `.filter` `<ul>` with a connected segmented control at the top of the menu
column: **All · In Progress · Completed · Trash**, each with a small count badge.
- Stability fix: **All / In Progress / Completed are always shown** (badge shows 0) so the
  control stops jumping. **Trash** appears only when `recycleBin.length > 0`.
- Drives the existing `intention` state; last-used filter still persists (`FILTER_KEY`).

### 2. Batch actions → contextual bar
A single thin bar below the tabs shows only the bulk action relevant to the current filter:
- `all` / `ongoing` → **Finish all** (when `leftTodosCount > 0`)
- `completed` → **Clear completed** (when `completedTodosCount > 0`)
- `removed` (Trash) → **Restore all** · **Empty trash** (when `recycleBin.length > 0`)

This replaces the always-on Finish All / Clear Completed buttons **and** the redundant
`btn-allFinish` "Mark All Done" in the bar-message area (folded in here). Global
destructive **Clear All** moves into the More menu (rare, guarded by its existing confirm).

### 3. Data drawer → "⋯ More" menu
One **⋯ More** button (bottom of the menu column) opens a sectioned panel — a popover on
desktop, a bottom sheet on mobile (CSS-only responsive; reuses the existing modal/overlay
pattern). Sections:
- **Organize:** Sort A–Z
- **Clean up:** Clear All _(danger)_
- **Data:** Add many · Export _(file · clipboard)_ · Import _(file · paste)_
- **App:** Settings · Reload

Export/Copy and Import/Paste are **paired by intent**: each shows as one labeled row with two
small channel chips, halving the vertical space and removing "which one do I want?" hesitation.
Closes on action, Esc, or outside-click.

### 4. Command palette (⌘K / Ctrl-K)
Additive power-user layer; never in the way. Opens a centered modal with a search field and
the available actions (from the registry). Substring/fuzzy match on label; ↑/↓ to move, Enter
to run, Esc to close. Triggered by **Cmd/Ctrl-K** and a small clickable hint in the menu. No
bare-key trigger (avoids clashing with typing in the add field). On touch devices the More
sheet is the primary path; the palette still works with a hardware keyboard.

## Files touched

- `public/js/app.js` — add `actions` computed registry, palette state + open/close +
  keyboard handler + fuzzy filter, contextual-bar computed (`contextAction`), tab-count
  computed/badges, `showMore` popover state. Reuse all existing action methods.
- `public/js/i18n.js` — new strings (menu/section/palette labels, channel chips, badges) for
  **both** `en` and `zh`. Follow existing key style.
- `index.html` + `index-zh.html` — replace the three `.todo-func-list` `<ul>`s with: tabs +
  contextual bar + More button; add the More panel and palette modal markup (mirrors the
  existing settings/bulk/paste modal structure). Bump `version` meta tag.
- `public/css/style.scss` (+ compiled `style.css` / `style.min.css`) — segmented tabs, badges,
  contextual bar, More popover/bottom-sheet, palette modal. Theme via existing CSS variables.
- `test/logic.test.js` — extend with the new pure logic: the action `when`-availability filter
  and the palette fuzzy-match. Zero-dependency, run with `node test/logic.test.js`.
- Version bump **1.1.0 → 1.2.0** across `window.UIINEED_VERSION`, both `version` meta tags,
  `CHANGELOG.md`, `README.md`, `ROADMAP.md`.

## Reliability / don't-get-in-the-way details

- Palette and More both render **only available** actions (`when` true) — no dead/disabled rows.
- Cmd/Ctrl-K is captured only when the palette can open; Esc always closes the topmost layer.
- Outside-click and Esc close the More popover; focus returns to the trigger.
- Keyboard handler is removed on `beforeDestroy` (no leaked global listeners).
- Mobile: tabs horizontally scroll if cramped; More is a thumb-reachable bottom sheet.
- Both language files stay in lock-step (a known historical bug class here).

## Out of scope

No backend/sync changes, no new storage model, no Vue upgrade, no build step, no change to
the import/export *logic* (only how it's surfaced). Icons are inline SVG/emoji consistent with
the current data-URI approach — no icon-font dependency.

## Testing & acceptance

- `node test/logic.test.js` passes, including new availability-filter and fuzzy-match cases.
- Manual: every old capability is reachable via tabs / contextual bar / More / palette; no
  function lost. Destructive actions still confirm. Filters persist. EN and ZH match.
- Visual sanity across at least Classic, Dark, and High-Contrast themes; desktop + mobile width.
