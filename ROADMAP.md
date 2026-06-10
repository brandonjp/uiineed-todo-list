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
  below and removes a whole class of "fixed in EN, forgot ZH" bugs.
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

### Recommended approach (tiered, pick one)

**Option A — "Sync code" via a tiny hosted KV (RECOMMENDED).**
- Use a free, no-auth-friendly key-value endpoint. Good fits: **Cloudflare Workers + KV**
  (you control it, generous free tier), or a hosted JSON bin service. The app gets a
  **"Sync ID"** (a random, hard-to-guess token the user generates once and enters on each
  device, like a shared room key).
- Flow: **Push** = `PUT {syncId} -> {todos, recycleBin, slogan, updatedAt}`. **Pull** =
  `GET {syncId}` on load / on a "Sync now" button. Last-write-wins by `updatedAt`, with a
  visible timestamp so the user knows what they're looking at.
- Pros: matches the "refresh is fine" requirement exactly, no accounts, ~100 lines, keeps the
  static premise (the HTML stays static; it just talks to one URL). Cons: requires standing up
  one tiny Worker (or trusting a third-party bin).
- **Privacy/security notes:** treat the Sync ID as a bearer secret (anyone with it can
  read/write). Use a long random id. Optionally add client-side encryption (passphrase →
  WebCrypto AES-GCM) so the server only stores ciphertext — nice-to-have, not required for v1.

**Option B — Browser-native, zero-server.** Rely on the browser's own account sync (Chrome/
Safari already sync `localStorage`? — **no, they do not**), so this isn't viable for
cross-device. Skip.

**Option C — File-based "sync" via a cloud drive.** Lean on the improved export/import
(Section 5): export to clipboard/file, drop into iCloud/Dropbox, import on the other device.
Zero new infrastructure; fully manual. This is effectively **free and ships with Section 5**,
and is a fine fallback / v0 while Option A is built.

### Plan
1. Ship **Option C** behavior for free as part of Section 5 (clipboard import/export).
2. Build **Option A** as the real feature: a small "Sync" panel in Settings with
   *Generate Sync ID*, *Enter Sync ID*, *Push*, *Pull*, *auto-pull on load* toggle, and a
   "last synced" timestamp. Back it with a Cloudflare Worker + KV (document the Worker
   separately; keep its URL configurable).
3. Conflict handling: last-write-wins keyed on `updatedAt`; warn if remote is newer than the
   local copy you're about to overwrite.

> Decision needed from owner: are you willing to deploy a tiny Cloudflare Worker (best
> experience), or should we stick to clipboard/file sync (Option C) only? This gates the
> effort estimate for the sync line item.

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

### Phase 0 — Quick wins & safety (hours, low risk)
1. **QOL-3** Hide delete-X while editing. _(tiny, high UX)_
2. **QOL-1** Persist last-used filter. _(tiny)_
3. **QOL-4** Reload button (+ basic PWA manifest meta). _(tiny)_
4. **BUG-1** Persist recycle bin. _(small, fixes data loss)_
5. **BUG-4 / BUG-5 / SEC-3** Prune dead code, add `rel="noopener"`. _(tiny cleanup)_

### Phase 1 — Foundation refactor (do before big features)
6. **TECH-DEBT-1** Extract shared `app.js` + i18n string maps; dedupe EN/ZH. _(medium, unlocks everything)_
7. **BUG-2** Stable unique IDs. _(small, but touch it during the refactor)_
8. **SEC-1 / BUG-3** Harden alert (`textContent`) and import parser. _(small–medium)_

### Phase 2 — High-value features
9. **IO-1…IO-5** Clipboard export/import + bulk entry + hardened parser. _(medium; also delivers Option C "manual sync")_
10. **THM-1 / THM-2 / SET-1** Settings panel + theme engine + 5 themes. _(medium; mostly CSS)_
11. **QOL-2** Auto-sort/alphabetize toggle. _(small)_

### Phase 3 — Larger / decision-gated
12. **MOB-1** Touch drag-to-reorder (+ fix TECH-DEBT-2) and **MOB-2…MOB-5** mobile polish. _(medium–large; headline mobile item)_
13. **Sync Option A** Cloudflare Worker + KV "Sync ID" flow. _(large; gated on owner's deploy decision — see Section 3)_

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
| IO clipboard + bulk entry | High | Medium | 2 |
| Themes + settings panel | High | Medium | 2 |
| QOL-2 auto-sort | Med | Small | 2 |
| MOB touch drag + polish | High | Med-Large | 3 |
| Sync (Worker + KV) | High | Large | 3 |

---

## 8. Open questions for the owner

1. **Sync infrastructure:** OK to deploy a tiny Cloudflare Worker + KV (best UX), or keep
   sync to clipboard/file only for now? (Gates item 13.)
2. **Refactor appetite:** Approve the Phase 1 dedupe of `index.html` / `index-zh.html` into a
   shared `app.js`? It's the highest-leverage change but touches both files broadly.
3. **Theme direction:** any specific themes/brand colors you want among the 5 (Dark is assumed)?
4. **SCSS workflow:** should we keep editing `.scss` and recompile, or are direct `.css` edits
   acceptable given no build is committed?
