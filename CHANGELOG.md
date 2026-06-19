# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [1.7.4] — 2026-06-18

### Fixed
- **OPEN side menu no longer overlaps the top nav on load.** v1.7.2 pinned the
  menu with `position: fixed` but anchored it at `top: 24px` — the same vertical
  band as the fixed `.nav` (GitHub / About / language switcher), so the language
  selector sat on top of the menu. The menu now anchors at `top: 203px`, level
  with the top of the task-list card (`.container.main` sits 202.6px below the
  viewport top on desktop, stable across all widths), restoring the pre-1.7.2
  load position while keeping the menu pinned and reachable as a long list
  scrolls. Mobile (bottom-docked) layout is unchanged.

## [1.7.3] — 2026-06-18

### Changed
- **Clearer drag feedback.** While dragging a card on desktop, the live source
  row is now hidden (its space preserved as a blank gap) so only the drag ghost
  is visible and the gap clearly marks where the item will land. The row
  reappears in place on drop. (The hide is deferred one tick so the browser's
  drag image is captured first and the ghost isn't blanked.)

## [1.7.2] — 2026-06-18

### Fixed
- **Drag-to-reorder now works in the In Progress and Completed views, not just
  All.** Reordering was hard-restricted to the All view (every drag handler
  bailed out with `intention !== 'all'`), so for anyone working in In Progress
  the drag never even started — the cursor showed a drag but nothing moved. A
  move made in a filtered view is now translated back onto the full list, so the
  visible items reorder while the hidden (e.g. completed) ones keep their places.
  Trash stays non-reorderable (its items live in the recycle bin, not the list).

### Added
- **The OPEN menu (filters / sort / actions) is now pinned on scroll.** On
  desktop it stays put in the right-hand gutter instead of scrolling out of view
  with a long list. Its horizontal position is unchanged; mobile is unaffected.

## [1.7.1] — 2026-06-18

### Fixed
- **Desktop drag-to-reorder, which regressed in 1.7.0.** The 1.7.0 rewrite
  switched from live-reordering during the drag to committing the move once on
  `dragend`. That fails outside Chrome: Safari and Firefox won't even start an
  element drag unless `dataTransfer.setData()` is called in `dragstart`, so the
  cursor showed a drag but the card never moved and nothing saved. Restored the
  long-standing **live-reorder-on-`dragenter`** behavior and added the
  `setData()` / `effectAllowed` / `dropEffect` calls that Safari and Firefox
  require. Dragging from a sorted view still bakes the visible order into the
  manual order first (so the indicator flips to Manual and the move sticks).

## [1.7.0] — 2026-06-18

### Added
- **Sorting is now a non-destructive view.** Your manual order is always
  preserved; A–Z / Z–A / Newest / Oldest / Shuffle reorder only what's shown.
  The sort button shows the active mode (Manual / A–Z / Z–A / Newest / Oldest /
  Shuffled) and the sort menu has a **Manual order** entry plus a ✓ on the
  active mode, so you always know what you're looking at and can get back.
- Shuffle rolls a stable random order once (stored locally) instead of
  re-shuffling on every edit; clicking Shuffle again re-rolls. A task added
  while shuffled appears at the top until the next shuffle.

### Fixed
- **Desktop drag-to-reorder now works.** Previously the list was re-spliced on
  every `dragenter`, and the keyed `<transition-group>` FLIP-moved the dragged
  row mid-drag, which aborts the native HTML5 drag — so the reorder never
  landed. The move is now committed once on `dragend`, leaving the dragged node
  in place during the gesture. Touch drag continues to work.

### Changed
- Choosing a sort no longer reorders your other synced devices (sorting no
  longer mutates `todos`). The sort/view preference is stored locally
  (`uiineed-sort`) and is intentionally **not** synced.
- Dragging an item now defines your manual order: it bakes the current visible
  order in and switches the indicator to **Manual**.

## [1.6.4] — 2026-06-18

### Fixed
- **Imported todos no longer vanish on refresh, and the filter counts (All /
  In Progress / Completed) update correctly after an import or first-device
  sync.** `mergeImport()` appended new items with `Array.prototype.unshift.apply(
  targetList, added)`, which calls the *native* `unshift` and bypasses Vue 2's
  reactive array interceptor on `this.todos` / `this.recycleBin`. The items
  landed in the array (so they rendered), but Vue was never notified — so the
  computed tab counts stayed frozen at their pre-import values (e.g. *All 41 /
  In Progress 0 / Completed 0*), **and** the deep `todos` watcher never fired, so
  the import was never written to `localStorage`. The data lived only in memory:
  a page refresh reloaded the empty stored list and the import appeared to "wipe
  itself out" — the same path also affected first-contact cross-device sync
  (`mergeRemote`). Fixed by dispatching through the array's own (Vue-patched)
  `unshift` (`targetList.unshift.apply(targetList, added)`), restoring reactivity,
  live counts, and persistence. Regression test added (a spy proves `mergeImport`
  routes through the instance method, not `Array.prototype`). Introduced in 1.6.1.

### Changed
- **Cache-busting on app assets.** `app.js`, `i18n.js`, and `style.min.css` are
  now referenced with a `?v=1.6.4` query string in `index.html` / `index-zh.html`
  (and the stale `<meta name="version">` updated from `1.6.0` → `1.6.4`). The
  deployment sets no explicit cache headers, so browsers were heuristically
  caching the JS — devices could keep running an old `app.js` after a deploy.
  Bumping the query on each release forces a fresh fetch so fixes actually land.

## [1.6.3] — 2026-06-18

### Fixed
- **Modal buttons are now styled.** The `.custom-alert-btn` class used by every
  modal's action buttons (alert/confirm dialogs *and* the static bulk/paste/
  settings modals) had no CSS rule, so the global `button` reset left them as
  plain text. Added neo-brutalist button styling matching the rest of the app
  (`.custom-alert-btn` base + `:hover`/`:focus-visible`/`:active`, with
  `.confirm` using the `--normal` accent and `.cancel` neutral) — added to
  `style.scss`, `style.css`, and the served `style.min.css`. All driven by theme
  CSS variables, so every theme adapts automatically. Adds a visible focus ring
  for keyboard users (the global `button:focus{outline:none}` had removed it).

### Changed
- Default `alert()` dialog title (EN) changed from **"Prompt"** to **"Notice"** —
  it backs info messages like the import/bulk summaries, for which "Prompt" read
  oddly. (The Chinese title "提示" already meant "Notice" and is unchanged.)

## [1.6.2] — 2026-06-18

### Fixed
- **Alert/confirm dialogs now render styled.** `buildDialog()` (which backs the
  overridden `window.alert`/`window.confirm` — import summaries, export/clipboard
  errors, bulk results, etc.) built its DOM with `custom-alert-*` class names that
  no longer exist in the stylesheet; the styled modal system had been renamed to
  `ui-modal-*`. With no matching CSS (and the global `button` reset stripping
  chrome), every alert/confirm collapsed to raw unstyled text in the page corner.
  `buildDialog()` now emits the same `ui-modal-overlay` / `ui-modal` /
  `ui-modal-title` / `ui-modal-hint` / `ui-modal-buttons` classes the static
  modals use, so dialogs render as a centered card with a backdrop. No CSS or
  behavior changes; pure class-name alignment.

## [1.6.1] — 2026-06-18

### Fixed
- **Import order preserved.** `mergeImport()` added each new item with
  `unshift` inside the loop, which silently **reversed** the imported list (the
  last item in the file landed on top, the first sank to the bottom). New items
  are now collected in file order and batch-unshifted once, so they still land
  at the front (like a single new todo) but keep the order they appear in the
  imported/synced file. Dedupe/update/skip behavior and the returned counts are
  unchanged. Covered by two new `mergeImport` order tests in `test/logic.test.js`.

## [1.6.0] — 2026-06-18

Optional **cross-device sync** for private deployments, via a tiny same-origin
PHP backend. Fully opt-in: if the backend isn't present, the app behaves exactly
as before (per-browser `localStorage`, no errors).

### Added
- **`sync.php`** — a same-origin endpoint that stores ONE JSON snapshot (todos +
  recycle bin + slogan + an `updatedAt` stamp) in a file kept **outside the web
  root**. `GET` returns the blob; `PUT`/`POST` validates it is a JSON object and
  writes it atomically (temp file + `rename`, `LOCK_EX`), with a 5 MB cap. It
  carries **no auth code on purpose** — the site's existing HTTP Basic Auth gates
  every request, and the storage path is a fixed server-side constant (no
  path-traversal vector). Generic and host-agnostic, safe for the public repo.
- **Client sync** in `public/js/app.js`: on load it silently probes `sync.php` and
  reconciles; on every change it debounces a `PUT`. Reconciliation is **blob-level
  last-write-wins** by `updatedAt` (`planSync()`), so deletions propagate. The one
  exception is **first contact** on a device — it unions local + remote (via the
  existing tested `mergeImport`) so nothing is lost the first time you connect.
- **"Sync now"** action wired through the existing `actions` registry, so it shows
  up in the **⌘K command palette** and the **More** menu, plus a clickable
  **sync-status indicator** (last-synced time / syncing / offline) in the sidebar.
- New i18n strings (EN + ZH) for the sync UI; `uiineed-sync` localStorage key for
  the local sync bookkeeping (`updatedAt` + `synced`).

### Notes
- **Graceful degradation:** with no `sync.php` (static host, `file://`, no PHP) the
  silent probe simply fails and the app stays 100% local — the status row stays
  hidden until you explicitly trigger a sync.
- Last-write-wins is deliberately **rudimentary** (no per-item merge): refreshing
  on another device pulls the latest snapshot. See `ROADMAP.md` §3.

## [1.5.0] — 2026-06-18

Optional hardening for running the app as a **private** static deployment.

### Added
- **`robots.txt`** (`Disallow: /`) plus a `noindex, nofollow, noarchive, nosnippet,
  noimageindex` `<meta name="robots">` in both `index.html` and `index-zh.html` —
  keeps a private instance out of search indexes (defense in depth).
- **`.htaccess.example`** — copy/paste Apache config to force HTTPS, send an
  `X-Robots-Tag: noindex` header, and gate the whole site behind **HTTP Basic Auth**
  (`Require valid-user`, no anonymous access). Your real `.htaccess` / `.htpasswd`
  are git-ignored so deployment specifics never enter version control.

### Notes
- Todo data is still **per-browser `localStorage`** — never sent to a server — so
  each browser/device keeps its own independent list. The Basic Auth example
  controls who can *load the app*, not where data lives. (Cross-device sync is
  tracked separately in `ROADMAP.md` §3.)

## [1.4.0] — 2026-06-12

Sort reliability, a shuffle option, and theme-contrast fixes for the menu.

### Fixed
- **Newest / Oldest sort now works for everyone.** Ordering keys off a real
  `createdAt` stamp instead of parsing the id, so todos with legacy/non-timestamped
  ids sort correctly. `createdAt` is added to new items and backfilled on load
  (from the id time when available, else stored position).
- **Theme contrast.** The right-side menu (sidebar, tabs, More/Sort/palette
  surfaces, chips, the command-palette input) and the bulk/paste textarea used a
  hardcoded white background — unreadable on Dark / High-Contrast. They now use the
  theme's `--bg-normal`, and badges/danger text use theme-safe colors.

### Added
- **Shuffle** sort mode (random order) in the Sort menu and ⌘K palette.

### Internal
- Pure `sortTodos` (replaces `compareBy`) + `backfillCreatedAt` / `nextStamp`;
  unit tests updated to cover createdAt-priority and stable fallback ordering.

## [1.3.0] — 2026-06-12

Follow-up polish on the new menu: safer destructive actions and richer sorting.

### Added
- **Multiple sort modes.** A prominent **"⇅ Sort"** button under the tabs opens
  a menu: **A–Z**, **Z–A**, **Newest first**, **Oldest first**. Newest/Oldest are
  derived from the timestamp already encoded in each item's id (no data-model
  change). All four are also runnable from the ⌘K palette.

### Changed
- **Safer "Finish all".** Instead of a dismissible modal, the context-bar
  "Finish all" now uses an inline two-step confirm: one tap arms it with a 3-second
  countdown, then it reads **"Tap to confirm"** (highlighted) — only that second
  tap completes everything. It auto-cancels if you switch views, press Esc, or
  wait. (The More-menu / palette "Finish all" keeps its modal confirm.)

### Internal
- New pure helpers `idTime` / `compareBy` (unit-tested) back the sort modes; sort
  commands live in the same `actions` registry, so they appear in the palette too.

## [1.2.0] — 2026-06-12

A right-side-menu UX overhaul. The old ~15-button strip is reorganized around a
single data-driven action registry that feeds two surfaces.

### Added
- **Filter tabs.** All / In Progress / Completed / Trash are now a segmented tab
  control with live count badges. All/In Progress/Completed are always shown (no
  more jumpy menu); Trash appears only when it has items.
- **Context action bar.** Each view shows only the bulk action that fits it:
  Finish all (All/In Progress), Clear completed (Completed), and Restore all /
  Empty trash (Trash).
- **"More" menu.** Sort, Clear All (destructive), Add many, Settings, Reload, and
  Export/Import live in one tidy panel. Export pairs File · Clipboard; Import
  pairs File · Paste — same intent, channel as a secondary choice.
- **Command palette (⌘K / Ctrl-K).** Fuzzy-search and run any action from the
  keyboard; ↑/↓ to move, Enter to run, Esc to close.

### Changed
- The redundant top "Mark All Done" button folds into the context bar.
- Added `restoreAll` / `emptyTrash` bulk Trash operations.

### Internal
- New pure helpers `fuzzyMatch` / `searchActions` (unit-tested) power both the
  More menu and the palette from one `actions` registry.

## [1.1.0] — 2026-06-11

First tracked release. A round of improvements (audit fixes, shared-code
refactor, sync, theming, mobile drag) followed by a full code-review hardening
pass. See `ROADMAP.md` for the planning detail.

### Added
- **Shared code architecture.** All app logic now lives in `public/js/app.js`
  and all UI strings in `public/js/i18n.js`; `index.html` (EN) and
  `index-zh.html` (ZH) load the same modules instead of duplicating logic.
  Adding a language is now data-only (a new block in `i18n.js`).
- **Themes + settings panel.** Classic, Dark, Sepia, Ocean, High-Contrast,
  Pastel, and Auto (follows the OS light/dark setting, live). Persisted to
  `uiineed-settings`.
- **Import / export overhaul.** Copy-to-clipboard and paste-from-clipboard
  (with a textarea fallback), a bulk-add modal, and a hardened parser that
  accepts a JSON array, a `{todos:[…]}` backup object, a JSON array of strings,
  or newline-delimited text. Exports are now a full JSON backup.
- **Dedupe on import / bulk-add.** Re-importing an overlapping export no longer
  creates duplicates: items are matched by stable id first, then by normalized
  title + completed state, and the result is reported (added / updated /
  skipped). This is the supported cross-device sync path (file/clipboard via
  iCloud/Dropbox/Drive).
- **Touch drag-to-reorder** on mobile (long-press to pick up; a quick swipe
  still scrolls).
- **Persisted recycle bin** (`uiineed-recycle`) — deleted items survive a
  refresh and the Trash filter is populated on load.
- **Quality-of-life:** persisted last-used filter, one-shot A–Z sort, a Reload
  button (for Home-Screen web-app use), and the delete (×) is hidden while an
  item's inline editor is open.
- **Versioning + test harness.** A `version` meta tag in both pages and
  `window.UIINEED_VERSION`; a zero-dependency Node test (`test/logic.test.js`)
  that exercises the real parse/merge/dedupe code (`node test/logic.test.js`).

### Fixed (code-review hardening, 2026-06-11)
- **Data loss when editing a trashed item to an empty title.** `removeTodo` /
  `restoreTodo` did `splice(indexOf(...))` without checking for `-1`, so a miss
  spliced index `-1` and silently moved/deleted the wrong item. Both now guard.
- **Cross-device sync dropped stable ids.** `mergeImport` regenerated an id for
  every imported item, so edited titles produced duplicates on a later
  re-import. Non-colliding incoming ids are now preserved.
- **Full backups didn't restore the recycle bin.** Exports include `recycleBin`
  but import ignored it; trashed items are now restored (and deduped) on import.
- **Stable ids replaced XSS-prone dialogs.** Custom `alert`/`confirm` set text
  via `textContent` (no `innerHTML`), removing the import-error XSS vector.
- **Storage writes no longer throw.** All `localStorage` writes are wrapped so a
  full/disabled store (e.g. Safari private mode) can't break Vue reactivity.
- **`auto` theme reacts to live OS changes** without a reload.
- **Robustness:** `dragIndex` uses `null` (not `''`); the enter animation has a
  fallback so an item can't hang if `transitionend` never fires; the import file
  `<input>` is cleaned up in the change handler (fixes the iOS Safari picker).
- Synced the new styles back into the `style.scss` source (they previously
  existed only in the compiled `style.css` / `style.min.css`).

### Security
- Added `rel="noopener noreferrer"` to all `target="_blank"` links.
- Removed dead/legacy code (`shuffle`, `lineFeed`, empty watcher, debug logs).

## [1.0.0] — baseline

The original Uiineed Todo List by RicoCC: a static, build-free Vue 2.x todo app
with localStorage persistence, EN/ZH pages, recycle bin, inline edit, and
file import/export.
