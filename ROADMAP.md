# Uiineed Todo List — Improvement Roadmap

> Planning document for a round of improvements: code review/security audit, mobile
> UX, lightweight cross-device sync, import/export, theming, and assorted quality-of-life
> features. Triaged by **impact vs. effort** so we ship the high-value, low-risk wins first.

_Last updated: 2026-06-10_

---

## 1. Architecture snapshot & constraints

Understanding these shapes every decision below.

- **Static, build-free app.** Everything is hand-written HTML + inline `<script>`. Vue
  **2.x** is vendored at `public/js/vue.js` (no CDN, no bundler, no `package.json`). You
  open the `.html` file and it runs. **We should preserve this** — it is the whole premise.
- **Two duplicated entry points.** `index.html` (English) and `index-zh.html` (Chinese)
  contain near-identical markup *and* logic. Today every behavior change must be made
  **twice**. This duplication is the single biggest tax on all future work (see TECH-DEBT-1).
- **Styling.** `public/css/style.scss` is the source; `style.css` and `style.min.css` are
  compiled outputs. There is no build script committed, so SCSS must be recompiled manually
  (e.g. `sass`) or edits made directly to the CSS. Good news: the design already uses
  **`:root` CSS custom properties** (`--body-bg`, `--font-color`, `--normal`, etc.), so
  theming is mostly a matter of overriding variables.
- **Data model.** `localStorage` key `uiineed-todos` holds an array of
  `{ id, title, completed, removed }`. Slogan in `uiineed-slogan`, language in
  `uiineed-todos-lang`. The **recycle bin is in-memory only** (not persisted).
- **State management.** A single Vue instance (`#todo-app`). Import/export logic lives
  *outside* Vue in plain DOM scripts at the bottom of the file.

---

## 2. Code review & security audit (Task: full review + audit)

Findings from reading `index.html`. Severity: 🔴 high · 🟠 medium · 🟡 low/cleanup.

### Correctness bugs
- 🔴 **BUG-1 — Recycle bin is never persisted.** `recycleBin` is initialized as `[]` in
  component `data` and only the `todos` array is written to `localStorage`. Deleting an item
  then refreshing **loses the trash entirely**, and the "Trash" filter is empty on every
  load. Fix: persist `recycleBin` to its own storage key (and restore on boot). _This also
  becomes important for sync (Section 3)._
- 🟠 **BUG-2 — IDs are reassigned to array index on every fetch.** `todoStorage.fetch()`
  does `todo.id = index`. IDs are therefore **not stable** across reloads and not unique
  across the `todos` + `recycleBin` partition. `:key="todo.id"` in the `v-for` can collide,
  causing Vue to mis-render/animate the wrong rows. Fix: assign a stable unique id
  (timestamp + counter, or `crypto.randomUUID()`) at creation and never rewrite it.
- 🟠 **BUG-3 — Import trusts `file.type` and assumes an array.** The importer branches on
  `file.type === 'application/json'` / `'text/plain'`, which is unreliable across OSes/browsers,
  and then calls `importedData.forEach` without validating it is an array of well-formed
  todos. A malformed file throws or injects junk objects. Fix: parse by content, validate
  shape, coerce/skip bad entries.
- 🟡 **BUG-4 — `nativeConfirm = window.alert`.** Line ~56 aliases the wrong function (dead
  code, but misleading). Remove.
- 🟡 **BUG-5 — Dead/legacy methods.** `shuffle()` references an undefined `_` (lodash not
  loaded); `lineFeed()` is defined but unused; `contorlScreen` is misspelled; `windowWidth`
  watcher is empty. Prune.

### Security
- 🟠 **SEC-1 — `innerHTML` in custom `alert`/`confirm`.** The replacement modal builds its
  body with `alertBox.innerHTML = \`...${message}...${title}...\``. Most call sites pass static
  strings, **but** the import error path passes `error.message` and could in principle carry
  attacker-influenced text from a malicious import file. This is a stored/reflected-XSS vector.
  Fix: set text via `textContent`, or escape interpolated values. Low real-world exploitability
  (local-only app) but trivial to fix and worth doing.
- 🟡 **SEC-2 — Todo titles.** Rendered via Vue `{{ }}` mustaches, which **auto-escape** — so
  titles are currently safe. Keep it that way: never switch a todo title to `v-html`.
- 🟡 **SEC-3 — External links** use `target="_blank"` without `rel="noopener noreferrer"`.
  Add `rel` to prevent reverse-tabnabbing.
- 🟢 Note: no secrets, no backend, no eval. Attack surface is genuinely small. The audit's
  main value is BUG-1/BUG-2 and hardening import + alert.

### Architecture / maintainability
- 🟠 **TECH-DEBT-1 — Logic duplicated across `index.html` and `index-zh.html`.** Strongly
  recommend extracting the Vue app + storage + import/export into a shared
  `public/js/app.js`, with each HTML file supplying only its localized strings (an i18n
  string map). This is the highest-leverage refactor: it halves the cost of **every** feature
  below and removes a whole class of "fixed in EN, forgot ZH" bugs. **See Section 9 for the
  full i18n architecture and how to add new languages.**
- 🟡 **TECH-DEBT-2 — Drag handlers mutate a computed.** `dragenter` splices
  `this.filteredTodos`, which is a `computed` derived from `todos`. Mutating it is an
  anti-pattern that happens to work only because it returns the same array reference for the
  `all` filter; it silently does nothing meaningful for filtered views. Reordering should
  mutate `todos` directly and be disabled (or mapped back) when a filter is active. Must be
  addressed as part of the mobile-drag work (Section 4).
- 🟡 **TECH-DEBT-3 — Import/export live outside Vue** and reach into `localStorage` + reassign
  `app.todos` directly. Fold these into Vue methods for consistency once we touch them.

---

## 3. Lightweight cross-device sync (Task: sync without overhauling the premise)

**Goal:** view the same list on two devices; a manual page refresh to pull latest is
acceptable. We must NOT turn this into a login-required, server-heavy product.

> **Decision (2026-06-10):** No server for now. **Ship file/clipboard-based sync (Option C)**
> as the supported path. The hosted "Sync ID" approach (Option A) is documented below as a
> **possible future upgrade** if manual sync proves too tedious — not built yet. A hard
> requirement either way: **import must detect and dedupe** so re-importing the same export
> doesn't create duplicates.

### Chosen approach — Option C: file / clipboard sync via a cloud drive

- Lean on the improved export/import (Section 5): export to clipboard or file, drop the file
  into **iCloud Drive / Dropbox / Google Drive**, then import on the other device (or just
  paste from clipboard if both devices share a clipboard, e.g. Apple Universal Clipboard).
- Zero new infrastructure, no accounts, fully under the user's control. Ships **for free** as
  part of Section 5. A page refresh after import shows the synced list — matches the
  "refresh is fine" requirement.
- **Dedupe on import is mandatory (see IO-6).** Each todo carries a stable id (BUG-2), so a
  re-import of an overlapping export merges cleanly instead of doubling entries.
- Trade-off accepted: sync is **manual** (you choose when to export/import). That's fine for
  the stated goal of "see the same list on both devices with a refresh."

### Future upgrade (documented, NOT built) — Option A: hosted "Sync ID" via tiny KV

If/when manual sync becomes annoying, add near-automatic sync without accounts:
- A free, no-auth-friendly key-value endpoint — **Cloudflare Workers + KV** (you control it,
  generous free tier) or a hosted JSON-bin service. The app gets a **"Sync ID"**: a long,
  hard-to-guess token generated once and entered on each device, like a shared room key.
- Flow: **Push** = `PUT {syncId} -> {todos, recycleBin, slogan, settings, updatedAt}`.
  **Pull** = `GET {syncId}` on load and/or a "Sync now" button. Last-write-wins by
  `updatedAt`, with a visible "last synced" timestamp; warn if remote is newer than the local
  copy about to be overwritten.
- Keeps the static premise (the HTML stays static; it just talks to one configurable URL).
- **Privacy/security notes for later:** treat the Sync ID as a bearer secret (anyone with it
  can read/write) — use a long random id. Optionally add client-side encryption (passphrase →
  WebCrypto AES-GCM) so the server only ever stores ciphertext.
- Cost to add later is small precisely because Section 5 already centralizes the
  export/import/merge payload — Option A would reuse that same serialization + dedupe logic.

**Rejected — Option B (browser-native sync):** Chrome/Safari do **not** sync `localStorage`
across devices, so there is no zero-server native path. Not viable.

---

## 4. Mobile UX (Task: touch drag-to-reorder + general mobile polish)

- **MOB-1 — Touch drag-to-reorder (headline item).** The current HTML5 Drag-and-Drop API
  (`dragstart`/`dragenter`) **does not fire on touch devices**, which is why the UI says
  "PC only." Options:
  - Add **Pointer Events**-based reordering (pointerdown/move/up) so one code path covers
    mouse + touch, OR vendor a tiny touch-capable sortable. Given the no-build constraint, a
    small hand-rolled pointer-events implementation (or a single vendored file like
    Sortable.js dropped in `public/js/`) is preferable to adding a framework.
  - Must also fix TECH-DEBT-2 (reorder the real `todos`, and disable/translate reordering when
    a filter is active). Add a visible **drag handle** on mobile so dragging doesn't fight with
    scrolling.
- **MOB-2 — Tap targets & spacing.** Audit button sizes against the 44×44px minimum; the small
  filter/action buttons and the finish/delete icons are tight on phones.
- **MOB-3 — The collapsible sidebar** (`shortCutAction`) already exists for <768px but is
  clunky; review the open/close affordance and make sure all actions are reachable.
- **MOB-4 — Inputs:** set appropriate `inputmode`/`enterkeyhint`, prevent iOS zoom-on-focus
  (font-size ≥ 16px on inputs — already 16px base, verify), and ensure the add-bar is
  reachable above the iOS keyboard.
- **MOB-5 — Safe areas & PWA:** respect `env(safe-area-inset-*)` for notch/home-bar; pairs with
  RELOAD button and Home-Screen web-app usage (Section 6).
- At least **3 of the 5 new themes** (Section 6) should be tuned for mobile legibility
  (contrast, larger touch chrome).

---

## 5. Import / export overhaul (Task: clipboard copy/paste + bulk entry)

- **IO-1 — Copy to clipboard (export).** Add "Copy to clipboard" alongside the existing file
  download; uses `navigator.clipboard.writeText(JSON)`. Keep file download as fallback.
- **IO-2 — Paste from clipboard (import).** Add "Paste from clipboard" using
  `navigator.clipboard.readText()` → validate → merge. Falls back to a paste-into-textarea
  modal where clipboard API is unavailable/permission-denied (Safari/iOS often prompts).
- **IO-3 — Bulk entry.** A "Add many" textarea modal: paste/type multiple lines → each
  non-empty line becomes a todo (trim, skip blanks, optional de-dupe). This shares the
  validation/merge code with import.
- **IO-4 — Harden the parser** (folds in BUG-3): accept both raw JSON and newline-delimited
  plain text; validate each entry; report how many were imported/skipped.
- **IO-5 — Round-trip everything:** export should include `recycleBin` + slogan + settings so
  it doubles as a full backup (and as the Option C manual-sync payload).
- **IO-6 — Dedupe on import (REQUIRED — this is what makes file/clipboard sync usable).**
  Re-importing an export that overlaps the current list must **not** create duplicates. Merge
  strategy:
  1. **Primary key = stable todo `id`** (from BUG-2). If an incoming id already exists, treat
     it as the *same item* and update-in-place (or skip) rather than appending.
  2. **Secondary guard = normalized title** (trimmed + lowercased, optionally whitespace-
     collapsed) for items that legitimately have no matching id (e.g. todos created on a device
     that predates stable ids, or hand-pasted bulk text). Same normalized title + same
     `completed` state ⇒ duplicate ⇒ skip.
  3. Report the outcome: "Imported N new, updated M, skipped K duplicates." This makes repeated
     manual syncs safe and predictable.
  - Same dedupe path is reused by **bulk entry (IO-3)** so pasting a list twice won't double it.

---

## 6. Themes, settings & quality-of-life features

### Settings panel (Task: simple settings)
- **SET-1 — Settings modal/panel.** A single gear-icon entry point housing: theme picker,
  sync controls (Section 3), auto-sort toggle, and links to import/export/bulk-add. Persist
  all settings under one `uiineed-settings` key.

### Theming (Task: theme selection + 5 new themes)
- **THM-1 — Theme engine.** Since `:root` already defines the palette as CSS variables,
  implement themes as `[data-theme="name"] { --body-bg: …; --normal: …; … }` blocks and set
  `document.documentElement.dataset.theme`. Persist selected theme; default to current look
  ("Classic").
- **THM-2 — Add 5 new themes**, e.g. Dark, Sepia/Warm, High-Contrast, Ocean, Pastel.
  **≥3 tuned for mobile** (higher contrast, larger chrome). Include `prefers-color-scheme`
  auto option.

### Smaller QoL wins
- **QOL-1 — Persist last-used filter.** Save `intention` to `localStorage` and restore on load
  (one-liner-ish; very high value). _Tiny effort, do early._
- **QOL-2 — Auto-sort / alphabetize.** A toggle (and/or one-shot button) to sort todos
  alphabetically; consider a secondary "completed last" sort. Must interoperate sanely with
  manual drag order (auto-sort off by default so dragging still works).
- **QOL-3 — Hide the delete (X) when an item's editor is open.** Current UX trap: users think
  the X closes the inline editor but it deletes the whole item. Conditionally hide/replace the
  delete button while `editedTodo.id === todo.id`. _Tiny effort, high UX value, do early._
- **QOL-4 — Reload button.** A visible refresh button (`location.reload()`) for iOS
  Home-Screen web-app use where there's no browser chrome. Pairs with adding a
  **web-app manifest** + `apple-mobile-web-app-capable` meta so "Add to Home Screen" behaves,
  and with MOB-5 safe-area handling.

---

## 7. Triage — recommended execution order

Ordered by **value ÷ effort**, front-loading quick wins and the audit fixes, and doing the
shared-code refactor before the big features so we only build them once.

### Phase 0 — Quick wins & safety (hours, low risk) — ✅ DONE
1. ✅ **QOL-3** Hide delete-X while the item's inline editor is open. _(tiny, high UX)_
2. ✅ **QOL-1** Persist last-used filter (`uiineed-filter`), with a fallback to "all" if the
   restored filter has no items.
3. ✅ **QOL-4** Reload button in the sidebar (`location.reload()`). _(PWA manifest meta still
   pending — fold into MOB-5.)_
4. ✅ **BUG-1** Persist recycle bin to `uiineed-recycle` (survives refresh).
5. ✅ **SEC-3 / cleanup** Added `rel="noopener noreferrer"` to all `target="_blank"` links;
   removed ZH-only debug `console.log` + dead commented code; removed the empty `windowWidth`
   watcher. _(BUG-2 stable IDs and BUG-3/SEC-1 hardening intentionally deferred to Phase 1.)_

### Phase 1 — Foundation refactor — ✅ DONE
6. ✅ **TECH-DEBT-1** Extracted all logic into `public/js/app.js` and strings into
   `public/js/i18n.js`; both HTML files load the shared modules and bind UI text via i18n
   (each keeps its own intentionally-different About section). `v-cloak` prevents template flash.
7. ✅ **BUG-2** Stable, unique, persisted ids (`genId`); ids are de-collided/migrated on load.
8. ✅ **SEC-1 / BUG-3** Dialogs now set text via `textContent` (no `innerHTML`); import parser
   accepts JSON array / `{todos:[]}` / string array / newline text, with validation.

### Phase 2 — High-value features — ✅ DONE
9. ✅ **IO-1…IO-6** Copy-to-clipboard + paste-from-clipboard (with textarea fallback modal),
   bulk-add modal, hardened parser, and **dedupe on import/bulk** (by stable id, then
   normalized title+state) reporting added/updated/skipped. Export is now a full JSON backup.
   _This is the supported cross-device sync path — file/clipboard via iCloud/Dropbox._
10. ✅ **THM / SET** Settings panel + theme engine + 5 new themes (Dark, Sepia, Ocean,
    High Contrast, Pastel) + Auto (prefers-color-scheme). Persisted to `uiineed-settings`.
11. ✅ **QOL-2** One-shot alphabetical sort button.

### Phase 3 — Mobile
12. ✅ **MOB-1** Touch drag-to-reorder (long-press to pick up, then drag; quick swipe still
    scrolls). Shared `moveItem` helper now backs both desktop DnD and touch, fixing
    **TECH-DEBT-2** (reorder no longer mutates a filtered computed; guarded to the "all" view).
    _Reorder logic verified headlessly; the touch gesture itself needs on-device verification._
13. ⬜ **MOB-2…MOB-5** Remaining mobile polish — tap-target sizing, sidebar affordance,
    `inputmode`/`enterkeyhint`, safe-area insets, and a PWA manifest (pairs with QOL-4 reload
    button for Home-Screen web-app use). _Not yet done._

### Future / not scheduled
- **Sync Option A** (hosted Cloudflare Worker + KV "Sync ID"). Documented in Section 3 as a
  possible later upgrade if manual file/clipboard sync proves tedious. Not built now.

### ⚠️ Verification status
All JavaScript was validated by a **headless jsdom mount harness** that boots both pages,
checks initial load / id-migration / filter-restore, and exercises add, sort, reorder,
import+dedupe, bulk-add, and the theme engine (no template/render errors, no mustache leak).
What still needs a **real browser / device**: visual look of the 5 themes (esp. Dark icon
inversion), the touch long-press gesture feel, and clipboard permission prompts on iOS Safari.

### Effort/impact summary

| Item | Impact | Effort | Phase |
|------|--------|--------|-------|
| QOL-3 hide X while editing | High | Tiny | 0 |
| QOL-1 persist filter | Med-High | Tiny | 0 |
| QOL-4 reload button + manifest | Med | Tiny | 0 |
| BUG-1 persist recycle bin | High | Small | 0 |
| Dead code / rel=noopener | Low | Tiny | 0 |
| TECH-DEBT-1 dedupe EN/ZH | High (leverage) | Medium | 1 |
| BUG-2 stable IDs | Med | Small | 1 |
| SEC-1 + BUG-3 harden | Med | Small-Med | 1 |
| IO clipboard + bulk entry + dedupe | High | Medium | 2 |
| Themes + settings panel | High | Medium | 2 |
| QOL-2 auto-sort | Med | Small | 2 |
| MOB touch drag + polish | High | Med-Large | 3 |
| Sync (Worker + KV) | High | Large | Future (deferred) |

---

## 8. Decisions & open questions

**Decided (2026-06-10):**
- ✅ **Sync:** No server for now. File/clipboard sync (Option C) is the supported path, with
  **mandatory dedupe-on-import** (IO-6). Hosted "Sync ID" (Option A) documented as a possible
  future upgrade only.
- ✅ **Refactor:** Approved — dedupe `index.html` / `index-zh.html` into a shared `app.js` with
  an i18n string map (Phase 1 / TECH-DEBT-1). See **Section 9** for how this works.

**Still open:**
1. **Theme direction:** any specific themes/brand colors you want among the 5 (Dark is assumed)?
2. **SCSS workflow:** keep editing `.scss` and recompile, or are direct `.css` edits acceptable
   given no build is committed?

---

## 9. Internationalization (i18n) architecture — EN/ZH dedupe & adding languages

This is the plan for **TECH-DEBT-1**. Today, `index.html` (English) and `index-zh.html`
(Chinese) are two near-complete copies — the markup, the Vue logic, the import/export scripts,
the empty-state tips — all duplicated, with only the visible text differing.

**How much have they actually diverged?** Verified by diffing the two files: the **feature
set, method names, data, and computeds are identical**. The only behavioral divergence was
leftover debug/dead code in the ZH file — a `console.log("实时屏幕宽度…")` in its
`windowWidth` watcher, plus a block of commented-out dead code (`logAllIds`, stale
`app.todos.push`) in `updatePageContent` — none of which existed in EN. (Both were removed in
Phase 0.) Beyond that, the files differ only in **formatting** (`function ()` vs `function()`,
indentation depth). So the case for dedupe is **not** "they've forked into different apps" —
it's that every future change must be made twice, and the formatting gap makes it hard to
verify by diff that the two stayed in sync.

### How translation will work

**Separate the three things that are currently tangled together:**

1. **App logic + markup → one shared `public/js/app.js`.** The Vue instance, storage,
   drag/sort, import/export — all the behavior — moves into a single file that both HTML pages
   load. There is exactly one copy of the logic from then on.
2. **Translatable text → a string map keyed by language.** Instead of hard-coding
   `"Add a to-do item..."` in the template, the template references a key and Vue looks it up
   for the active language:

   ```js
   // public/js/i18n.js
   const I18N = {
     en: {
       addPlaceholder: "Add a to-do item...",
       add: "Add", markAllDone: "Mark All Done",
       filterAll: "All", filterOngoing: "In Progress",
       filterCompleted: "Completed", filterTrash: "Trash",
       itemsRemaining: "{n} items remaining",
       allCompleted: "All completed, good job!",
       defaultSlogan: "Act Now, Simplify Life.☕",
       confirmMarkAll: "Confirm to mark all as completed?",
       // ...one entry per piece of visible text
     },
     zh: {
       addPlaceholder: "添加一个待办事项...",
       add: "添加", markAllDone: "全部完成",
       filterAll: "全部", filterOngoing: "进行中",
       filterCompleted: "已完成", filterTrash: "回收站",
       itemsRemaining: "还剩 {n} 项",
       allCompleted: "全部完成，做得好！",
       defaultSlogan: "立即行动，简化生活。☕",
       confirmMarkAll: "确认全部标记为已完成？",
       // ...same keys as `en`
     },
   };
   ```

3. **In the Vue app**, expose a tiny translator and use it in the template:

   ```js
   data() {
     return { lang: localStorage.getItem('uiineed-todos-lang') || 'en', /* ... */ };
   },
   computed: {
     t() {                       // usage in template: {{ t.add }}, :placeholder="t.addPlaceholder"
       return I18N[this.lang] || I18N.en;   // fall back to English if a key/lang is missing
     }
   }
   ```

   For strings with variables, a small helper handles the `{n}` placeholder, e.g.
   `tf('itemsRemaining', { n: count })`.

**The two HTML files then become thin shells.** They share the same `<div id="todo-app">`
template (ideally extracted into one shared HTML partial or simply kept identical and verified
by a diff check), and differ only in:
- `<html lang="…">`, `<title>`, and the `<meta>` description/keywords (SEO text per language),
- which language they default to.

The existing language switch (`En / 中`) keeps working — but instead of being two unrelated
pages, switching language just sets `localStorage['uiineed-todos-lang']` and the same app
re-renders with a different string set. We can keep `index.html` / `index-zh.html` as
SEO-friendly entry URLs (each pre-setting its language) while sharing 100% of the code.

### How to add another language (e.g. Spanish)

Once the above is in place, adding a language is **data-only — no logic changes:**

1. **Add one block to `I18N`** in `i18n.js` with the same keys:
   ```js
   es: { addPlaceholder: "Añadir una tarea...", add: "Añadir", /* ...all keys... */ }
   ```
2. **Add it to the language switcher** (one more link/option in the switch UI).
3. *(Optional, for SEO)* create `index-es.html` as a thin shell that defaults `lang` to `es`,
   mirroring how `index-zh.html` works. Not required for the feature to function — the
   in-app switcher alone is enough.

**Guardrails worth adding:**
- **English is the fallback.** Missing keys in any language resolve to `I18N.en`, so a
  half-translated language never shows blanks.
- A trivial **dev check** (a few lines, or a tiny script) can assert every language has the
  same set of keys as `en`, catching "forgot to translate X" before it ships.
- Keep keys **semantic** (`filterTrash`, not `button7`) so translators have context.

### Why this is worth doing first (Phase 1)

It's medium effort but it **removes the EN/ZH drift permanently** and makes every later feature
(themes, settings, clipboard sync, mobile drag) a single implementation instead of two. It also
turns "support more languages" from a copy-the-whole-file chore into appending one dictionary.
