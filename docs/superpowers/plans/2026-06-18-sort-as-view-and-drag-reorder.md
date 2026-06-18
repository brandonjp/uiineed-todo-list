# Sort-as-view + working drag-to-reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sorting a non-destructive view over a preserved manual order, fix the broken desktop drag-to-reorder, and always show the active sort mode.

**Architecture:** `todos` stays the canonical manual order; a `displayTodos` computed lens reorders `filteredTodos` for rendering without mutating `todos`. Deterministic sorts reuse the pure `sortTodos` helper; Shuffle rolls a stored `randomOrder` (ids) once. Dragging bakes the visible order into `todos` and switches to `'custom'` on start, then commits the move on `dragend` (no live DOM splice — that is what aborted the native drag).

**Tech Stack:** Vue 2 (no build step, static files), vanilla JS, localStorage, zero-dependency Node test harness (`node test/logic.test.js`).

## Global Constraints

- No build step — `public/js/app.js` is loaded directly; keep it ES5-style (`var`, function declarations) to match the file.
- `app.js` has a Node test hook at the top that `module.exports` pure helpers and `return`s before the browser bootstrap; new pure helpers must be defined before that block (hoisted decls) and added to the exports object.
- New sort/view preference is **local-only** (key `uiineed-sort`), persisted like `uiineed-filter` (`FILTER_KEY`) — never synced.
- `todos` continues to persist + sync exactly as today; sorting must never mutate it.
- Drag-reorder stays `'all'`-view only (existing `moveItem`/`touchStartItem` guard `intention !== 'all'`).
- i18n keys must be added in BOTH the `en` and `zh` blocks of `public/js/i18n.js`, kept in sync.
- All markup/version changes mirrored into `index-zh.html`.
- Version bump `1.6.4` → `1.7.0` everywhere: `app.js` `APP_VERSION`, `index.html`/`index-zh.html` `<meta name="version">` + every `?v=` (style.min.css, i18n.js, app.js), README current-version line, CHANGELOG entry.

---

### Task 1: Pure lens helper `orderByRandom` + `shuffleIds` (TDD)

**Files:**
- Modify: `public/js/app.js` (add helpers near `sortTodos` ~line 261; add to `module.exports` ~line 294)
- Test: `test/logic.test.js`

**Interfaces:**
- Produces: `orderByRandom(list, order)` → new array of the same todo refs ordered by each item's index in `order` (array of ids); ids not in `order` sort to the **top** preserving relative order; ids in `order` but absent are ignored. `shuffleIds(todos)` → array of the todos' ids in random order (Fisher–Yates).

- [ ] **Step 1: Write failing tests** in `test/logic.test.js` (after the `sortTodos` block, before the `planSync` block):

```js
// ---- orderByRandom (random lens) ----------------------------------------
test('orderByRandom: orders items by their position in the id list', function () {
    var a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' }, c = { id: 'c', title: 'C' };
    var out = core.orderByRandom([a, b, c], ['b', 'c', 'a']);
    assert.deepStrictEqual(out.map(function (t) { return t.id; }), ['b', 'c', 'a']);
});
test('orderByRandom: ids not in the order go to the TOP, keeping relative order', function () {
    var a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };
    // order knows only b,c,a; d is new (added after the shuffle)
    var out = core.orderByRandom([a, b, c, d], ['b', 'c', 'a']);
    assert.deepStrictEqual(out.map(function (t) { return t.id; }), ['d', 'b', 'c', 'a']);
});
test('orderByRandom: multiple new ids keep their relative (input) order at the top', function () {
    var a = { id: 'a' }, b = { id: 'b' }, x = { id: 'x' }, y = { id: 'y' };
    var out = core.orderByRandom([x, a, y, b], ['b', 'a']);
    assert.deepStrictEqual(out.map(function (t) { return t.id; }), ['x', 'y', 'b', 'a']);
});
test('orderByRandom: ids in order but absent from list are ignored', function () {
    var a = { id: 'a' }, b = { id: 'b' };
    var out = core.orderByRandom([a, b], ['b', 'gone', 'a']);
    assert.deepStrictEqual(out.map(function (t) { return t.id; }), ['b', 'a']);
});
test('orderByRandom: empty order -> input order unchanged', function () {
    var a = { id: 'a' }, b = { id: 'b' };
    assert.deepStrictEqual(core.orderByRandom([a, b], []).map(function (t) { return t.id; }), ['a', 'b']);
});
test('orderByRandom: returns same todo references', function () {
    var a = { id: 'a' }, b = { id: 'b' };
    var out = core.orderByRandom([a, b], ['b', 'a']);
    assert.strictEqual(out[0], b);
    assert.strictEqual(out[1], a);
});
test('shuffleIds: returns a permutation of the input ids', function () {
    var ids = core.shuffleIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.deepStrictEqual(ids.slice().sort(), ['a', 'b', 'c']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/logic.test.js`
Expected: throws `TypeError: core.orderByRandom is not a function`

- [ ] **Step 3: Implement the helpers** in `public/js/app.js` immediately after `sortTodos` (after its closing `}` ~line 261):

```js
    // Random "view" lens: order `list` by each item's index in `order` (an
    // array of todo ids rolled once at shuffle time). Ids missing from `order`
    // (e.g. a task added after the shuffle) sort to the TOP, keeping their
    // relative order — matching the app's "newest at top" add convention. Ids
    // in `order` but no longer present are ignored. Returns a NEW array of the
    // same todo references.
    function orderByRandom(list, order) {
        var pos = {}, ord = order || [], i;
        for (i = 0; i < ord.length; i++) pos[ord[i]] = i;
        return (list || []).map(function (todo, idx) {
            var p = pos[todo && todo.id];
            return { todo: todo, idx: idx, key: (p == null ? -1 : p) };
        }).sort(function (a, b) {
            return (a.key - b.key) || (a.idx - b.idx);
        }).map(function (x) { return x.todo; });
    }

    // Fisher–Yates shuffle of the todos' ids -> a fresh randomOrder array.
    function shuffleIds(todos) {
        var ids = (todos || []).map(function (t) { return t && t.id; });
        for (var i = ids.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
        }
        return ids;
    }
```

- [ ] **Step 4: Add to the Node export block** (`module.exports = { ... }` ~line 294), after `sortTodos: sortTodos`:

```js
            sortTodos: sortTodos,
            orderByRandom: orderByRandom,
            shuffleIds: shuffleIds
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node test/logic.test.js`
Expected: `All 48 tests passed.` (41 existing + 7 new)

- [ ] **Step 6: Commit**

```bash
git add public/js/app.js test/logic.test.js
git commit -m "feat(sort): add orderByRandom + shuffleIds pure lens helpers"
```

---

### Task 2: Sort/view state, persistence, computed lens & label

**Files:**
- Modify: `public/js/app.js` — storage key (~line 32), `loadSort()` (~after `loadSettings`), instance bootstrap (~line 453), `data` (~line 495), `watch` (~line 516), `computed` (`filteredTodos` ~549, add `displayTodos` + `currentSortLabel`), `actions` (~line 571), `sortBy` (~line 747), add `saveSort`/`setManual` methods.

**Interfaces:**
- Consumes: `orderByRandom`, `shuffleIds`, `sortTodos`, `safeSet` (from Task 1 / existing).
- Produces: data `sortMode` (`'custom'|'az'|'za'|'newest'|'oldest'|'random'`, default `'custom'`), data `randomOrder` (array of ids); computed `displayTodos`, `currentSortLabel`; `sortBy(mode)` non-destructive; `setManual()`.

- [ ] **Step 1: Add the storage key.** In the `// ---- Storage keys ----` block (after `FILTER_KEY` ~line 29):

```js
    var SORT_KEY = 'uiineed-sort';          // local view pref: { mode, randomOrder } — NOT synced
```

- [ ] **Step 2: Add `loadSort()`** after `loadSettings()` (~line 45):

```js
    // Local-only sort/view preference. Mirrors loadSettings: tolerant of
    // missing/garbage storage. If mode is 'random' but no order was stored,
    // fall back to 'custom' so the view is deterministic on first render.
    function loadSort() {
        try {
            var s = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
            var modes = ['custom', 'az', 'za', 'newest', 'oldest', 'random'];
            var mode = modes.indexOf(s.mode) >= 0 ? s.mode : 'custom';
            var order = Array.isArray(s.randomOrder) ? s.randomOrder : [];
            if (mode === 'random' && !order.length) mode = 'custom';
            return { mode: mode, randomOrder: order };
        } catch (e) {
            return { mode: 'custom', randomOrder: [] };
        }
    }
```

- [ ] **Step 3: Load the pref at bootstrap.** After `var syncMeta = loadSyncMeta();` (~line 455):

```js
    var sortPref = loadSort();
```

- [ ] **Step 4: Add the data props.** In the `data()` return object, right after `intention: localStorage.getItem(FILTER_KEY) || 'all', // restore last-used filter` (~line 465):

```js
                sortMode: sortPref.mode,        // custom|az|za|newest|oldest|random — a VIEW, not a mutation
                randomOrder: sortPref.randomOrder, // ids in shuffled order; the random lens reads this
```

- [ ] **Step 5: Add the persistence watchers.** In `watch:` after the `intention` watcher (~line 516):

```js
            sortMode: function () { this.saveSort(); },
            randomOrder: function () { this.saveSort(); },
```

- [ ] **Step 6: Add `displayTodos` + `currentSortLabel` computeds.** Immediately after the `filteredTodos` computed (after its closing `},` ~line 554):

```js
            // The rendered order: a non-destructive lens over filteredTodos.
            // 'custom' is identity (manual order). Deterministic modes reuse the
            // pure sortTodos helper. 'random' reads the stored randomOrder so it
            // stays stable across edits (recomputing would re-roll on every key).
            displayTodos: function () {
                var list = this.filteredTodos;
                if (this.sortMode === 'random') return orderByRandom(list, this.randomOrder);
                if (this.sortMode === 'custom') return list;
                return sortTodos(list, this.sortMode);
            },
            // Localized label for the sort button, reflecting the active mode.
            currentSortLabel: function () {
                var t = this.t;
                var map = {
                    custom: t.sortLabelManual, az: t.sortLabelAZ, za: t.sortLabelZA,
                    newest: t.sortLabelNewest, oldest: t.sortLabelOldest, random: t.sortLabelRandom
                };
                return map[this.sortMode] || t.sortLabelManual;
            },
```

- [ ] **Step 7: Add `mode` to each sort action + a Manual-order action.** Replace the five `sort-*` entries at the top of the `actions` array (~lines 572-576) with six entries (note the new `sort-manual` first and the `mode:` field on each):

```js
                    { id: 'sort-manual',    label: t.sortManual,       icon: '↕',  section: 'sort', mode: 'custom', when: this.todos.length > 1, run: function () { self.sortBy('custom'); } },
                    { id: 'sort-az',        label: t.sortAZ,           icon: '↓',  section: 'sort', mode: 'az',     when: this.todos.length > 1, run: function () { self.sortBy('az'); } },
                    { id: 'sort-za',        label: t.sortZA,           icon: '↑',  section: 'sort', mode: 'za',     when: this.todos.length > 1, run: function () { self.sortBy('za'); } },
                    { id: 'sort-newest',    label: t.sortNewest,       icon: '🕒', section: 'sort', mode: 'newest', when: this.todos.length > 1, run: function () { self.sortBy('newest'); } },
                    { id: 'sort-oldest',    label: t.sortOldest,       icon: '🕘', section: 'sort', mode: 'oldest', when: this.todos.length > 1, run: function () { self.sortBy('oldest'); } },
                    { id: 'sort-random',    label: t.sortRandom,       icon: '🔀', section: 'sort', mode: 'random', when: this.todos.length > 1, run: function () { self.sortBy('random'); } },
```

- [ ] **Step 8: Rewrite `sortBy` non-destructively + add `saveSort`/`setManual`.** Replace the whole `sortBy` method (~lines 747-759):

```js
            // Choose a sort VIEW. Never mutates this.todos (the manual order).
            // modes: 'custom' | 'az' | 'za' | 'newest' | 'oldest' | 'random'.
            sortBy: function (mode) {
                if (mode === 'random') {
                    this.randomOrder = shuffleIds(this.todos); // roll once; re-rolls on repeat click
                    this.sortMode = 'random';
                } else {
                    this.sortMode = mode; // 'custom' restores the manual order; others are pure views
                }
                this.closeSort();
            },
            setManual: function () { this.sortBy('custom'); },
            // Persist the local-only view pref (NOT synced), like the filter key.
            saveSort: function () {
                safeSet(SORT_KEY, JSON.stringify({ mode: this.sortMode, randomOrder: this.randomOrder }));
            },
```

- [ ] **Step 9: Sanity-check the Node hook still passes** (these edits are below the export `return`, so exports are unaffected):

Run: `node test/logic.test.js`
Expected: `All 48 tests passed.`

- [ ] **Step 10: Commit**

```bash
git add public/js/app.js
git commit -m "feat(sort): sortMode/randomOrder state, displayTodos lens, non-destructive sortBy"
```

---

### Task 3: Fix desktop drag (commit-on-dragend) + bake-to-manual on drag start

**Files:**
- Modify: `public/js/app.js` — `data` (add `dragOverIndex`), drag methods `dragstart`/`dragenter`/`dragover`/add `dragend` (~lines 1040-1048), touch long-press callback (~line 1062), add `bakeManualOrder` helper.
- Modify: `index.html` (li drag handlers ~line 127-129) and `index-zh.html` (~line 100-101).

**Interfaces:**
- Consumes: `displayTodos`, `sortMode`, `moveItem` (existing), `intention`.
- Produces: `bakeManualOrder()` (bakes visible order into `todos`, sets `sortMode='custom'`, `'all'`-view only); `dragend()` commits the tracked move; `dragOverIndex` data.

- [ ] **Step 1: Add `dragOverIndex` to `data()`** right after `dragIndex: null,` (~line 468):

```js
                dragOverIndex: null,
```

- [ ] **Step 2: Add `bakeManualOrder` + rewrite the desktop drag methods.** Replace the desktop drag block (~lines 1039-1048: `dragstart`, `dragenter`, `dragover`):

```js
            // Bake the current VISIBLE order into the manual order and switch to
            // it. Called at drag start so the rendered indices line up 1:1 with
            // this.todos before any move. Order is unchanged at this instant
            // (displayTodos === the rendered list), so no DOM node moves and the
            // native drag is not disturbed. 'all'-view only (drag is too).
            bakeManualOrder: function () {
                if (this.intention !== 'all') return;
                if (this.sortMode !== 'custom') {
                    this.todos = this.displayTodos.slice();
                    this.sortMode = 'custom';
                }
            },

            // Desktop HTML5 drag-and-drop.
            // We do NOT splice the list during the drag: moving the dragged <li>
            // in the DOM (as live reorder + the keyed transition-group's FLIP did)
            // aborts the native drag. Instead we track the hovered index and
            // commit the move once, on dragend.
            dragstart: function (index) {
                if (this.intention !== 'all') return;
                this.bakeManualOrder();
                this.dragIndex = index;
                this.dragOverIndex = index;
            },
            dragenter: function (e, index) {
                e.preventDefault();
                this.dragOverIndex = index; // track only; no list mutation mid-drag
            },
            dragover: function (e) { e.preventDefault(); }, // mark a valid drop target
            dragend: function () {
                this.moveItem(this.dragIndex, this.dragOverIndex); // single commit
                this.dragIndex = null;
                this.dragOverIndex = null;
            },
```

- [ ] **Step 3: Bake-to-manual when the touch long-press fires.** In `touchStartItem`, the `setTimeout` callback currently is `function () { self.touchDragging = true; }` (~line 1062). Replace it with:

```js
                this.touchTimer = setTimeout(function () {
                    self.bakeManualOrder(); // order unchanged; dragIndex still valid
                    self.touchDragging = true;
                }, 280);
```

- [ ] **Step 4: Add `@dragend` to the list item in `index.html`.** After `@dragstart="dragstart(index)"` (line 129):

```html
                                @dragend="dragend"
```

- [ ] **Step 5: Add `@dragend` to the list item in `index-zh.html`.** On the line with `@dragstart="dragstart(index)"` (line 101), append:

```html
                            @dragend="dragend"
```

- [ ] **Step 6: Verify the Node hook still passes** (no helper signatures changed):

Run: `node test/logic.test.js`
Expected: `All 48 tests passed.`

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js index.html index-zh.html
git commit -m "fix(drag): commit reorder on dragend; bake visible order to manual on drag start"
```

---

### Task 4: i18n keys (en + zh)

**Files:**
- Modify: `public/js/i18n.js` — `en` sort block (~lines 127-132) and `zh` sort block (~lines 261-266).

**Interfaces:**
- Produces keys (both blocks): `sortManual`, `sortLabelManual`, `sortLabelAZ`, `sortLabelZA`, `sortLabelNewest`, `sortLabelOldest`, `sortLabelRandom`.

- [ ] **Step 1: Add keys to the `en` block.** After `sortRandom: 'Shuffle',` (~line 132):

```js
        sortManual: 'Manual order',
        sortLabelManual: 'Manual',
        sortLabelAZ: 'A–Z',
        sortLabelZA: 'Z–A',
        sortLabelNewest: 'Newest',
        sortLabelOldest: 'Oldest',
        sortLabelRandom: 'Shuffled',
```

- [ ] **Step 2: Add keys to the `zh` block.** After `sortRandom: '随机打乱',` (~line 266):

```js
        sortManual: '手动排序',
        sortLabelManual: '手动',
        sortLabelAZ: 'A–Z',
        sortLabelZA: 'Z–A',
        sortLabelNewest: '最新',
        sortLabelOldest: '最早',
        sortLabelRandom: '已打乱',
```

- [ ] **Step 3: Commit**

```bash
git add public/js/i18n.js
git commit -m "feat(i18n): sort label + manual-order keys (en + zh)"
```

---

### Task 5: Markup — dynamic button label, displayTodos render, active sort menu (both HTML files + CSS)

**Files:**
- Modify: `index.html` — list `v-for` (line 122), sort button (line 238), sort menu (lines 320-325).
- Modify: `index-zh.html` — list `v-for` (line 97), sort button (line 184), sort menu (lines 266-270).
- Modify: `public/css/style.css`, `public/css/style.min.css`, `public/css/style.scss` — add `.more-item.active` + `.more-check`.

**Interfaces:**
- Consumes: `displayTodos`, `currentSortLabel`, `sortActions` (each item now has `.mode`), `sortMode`.

- [ ] **Step 1: Render the list from `displayTodos` (index.html).** Change line 122 from `v-for='(todo, index) in filteredTodos'` to:

```html
                                v-for='(todo, index) in displayTodos'
```

- [ ] **Step 2: Dynamic sort-button label (index.html).** Change line 238 from `⇅ {{ t.sortBtn }}` to:

```html
                                <button type="button" class="sort-btn" @click="openSort">⇅ {{ currentSortLabel }}</button>
```

- [ ] **Step 3: Active-state sort menu (index.html).** Replace the sort-menu button loop (lines 321-324):

```html
                            <button type="button" v-for="a in sortActions" :key="a.id"
                                class="more-item" :class="{ active: a.mode === sortMode }" @click="runAction(a)">
                                <span class="more-ico">{{ a.icon }}</span><span>{{ a.label }}</span>
                                <span class="more-check" v-if="a.mode === sortMode">✓</span>
                            </button>
```

- [ ] **Step 4: Mirror into index-zh.html.** Change line 97 `filteredTodos` → `displayTodos`; line 184 `{{ t.sortBtn }}` → `{{ currentSortLabel }}`; and replace the zh sort-menu loop (lines 267-269):

```html
                        <button type="button" v-for="a in sortActions" :key="a.id"
                            class="more-item" :class="{ active: a.mode === sortMode }" @click="runAction(a)">
                            <span class="more-ico">{{ a.icon }}</span><span>{{ a.label }}</span>
                            <span class="more-check" v-if="a.mode === sortMode">✓</span>
                        </button>
```

- [ ] **Step 5: Add CSS for the active item + checkmark.** Append after the `.more-item.danger:hover { ... }` rule (~line 1883) in `public/css/style.css`:

```css
.more-item.active {
  background: var(--normal);
  font-weight: 700;
}

.more-check {
  margin-left: auto;
  font-weight: 700;
}
```

Add the same two rules to `public/css/style.scss` (after the matching `.more-item` block) and append the minified equivalent to `public/css/style.min.css` (the file actually loaded):

```css
.more-item.active{background:var(--normal);font-weight:700}.more-check{margin-left:auto;font-weight:700}
```

- [ ] **Step 6: Commit**

```bash
git add index.html index-zh.html public/css/style.css public/css/style.min.css public/css/style.scss
git commit -m "feat(sort): render displayTodos, dynamic sort label, active sort menu + checkmark"
```

---

### Task 6: Version bump 1.6.4 → 1.7.0 + docs

**Files:**
- Modify: `public/js/app.js` (`APP_VERSION` line 19), `index.html` (`<meta>` line 7; `?v=` lines 18/32/446), `index-zh.html` (`<meta>` line 9; `?v=` lines 16/27/391), `README.md` (line 145), `CHANGELOG.md` (new top entry).

- [ ] **Step 1: Bump `APP_VERSION`** in `public/js/app.js` line 19: `var APP_VERSION = '1.7.0';`

- [ ] **Step 2: Bump `index.html`** — `<meta name="version" content="1.7.0">` and all three `?v=1.6.4` → `?v=1.7.0` (style.min.css, i18n.js, app.js).

- [ ] **Step 3: Bump `index-zh.html`** — same `<meta>` + three `?v=` query strings.

- [ ] **Step 4: Bump `README.md`** line 145 current-version `1.6.4` → `1.7.0`.

- [ ] **Step 5: Add `CHANGELOG.md` entry** at the top (above `## [1.6.4]`):

```markdown
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
```

- [ ] **Step 6: Final test run**

Run: `node test/logic.test.js`
Expected: `All 48 tests passed.`

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js index.html index-zh.html README.md CHANGELOG.md
git commit -m "chore(release): v1.7.0 — sort-as-view + working drag-to-reorder"
```

---

## Manual Verification Checklist (required before claiming done)

Open `index.html` in a desktop browser (and DevTools device mode / a real touch device for touch):

- [ ] Desktop: drag a row to a new position — it visibly reorders and **persists across reload**.
- [ ] Touch: long-press a row and drag — still reorders.
- [ ] Each sort mode (A–Z, Z–A, Newest, Oldest, Shuffle) renders the right order.
- [ ] Sort button label tracks the active mode; sort menu shows ✓ on the active mode.
- [ ] "Manual order" restores the pre-sort custom order **untouched**.
- [ ] Shuffle is stable across edits (toggle complete / edit title doesn't re-shuffle) and **re-rolls** on a second click.
- [ ] A task added while shuffled lands at the **top**.
- [ ] Switching sort does not reorder `todos` in storage (inspect `localStorage['uiineed-todos']` order is unchanged after a non-drag sort).
