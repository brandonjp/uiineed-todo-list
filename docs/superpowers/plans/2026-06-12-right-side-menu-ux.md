# Right-Side Menu UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded ~15-button right-side menu with a calm, hierarchical UX: segmented filter tabs, a single context-aware action bar, one "More" actions menu, and a ⌘K command palette — all driven by a single data-driven action registry.

**Architecture:** A single computed `actions` array in the Vue instance is the source of truth; it feeds both the More menu and the command palette. Filters become vertical segmented tabs in the existing floating sidebar; batch actions become a context bar that shows only what's relevant to the current filter; the data drawer collapses into a modal "More" panel; a global Cmd/Ctrl-K palette fuzzy-searches the registry. All existing action methods are reused verbatim. Both `index.html` (EN) and `index-zh.html` (ZH) load the same shared `public/js/app.js` + `public/js/i18n.js`, so the Vue template markup is identical across them.

**Tech Stack:** Static, build-free, vendored Vue 2.x; SCSS compiled with `sass` (1.56.1, on PATH) to `style.css` + `style.min.css`; `:root` CSS-variable theming; zero-dependency Node tests (`node test/logic.test.js`).

---

## File Structure

- `public/js/app.js` — add two pure helpers (`fuzzyMatch`, `searchActions`) + export them; add Vue state, the `actions`/`moreSections`/`contextActions`/`paletteResults` computeds, new methods (`openMore`/`closeMore`/`openPalette`/`closePalette`/`paletteMove`/`paletteEnter`/`runAction`/`byId`/`restoreAll`/`emptyTrash`/`onKeydown`), a `paletteQuery` watch, and `beforeDestroy`. Bump `APP_VERSION`.
- `public/js/i18n.js` — new UI strings in **both** `en` and `zh`.
- `index.html` / `index-zh.html` — replace the three `.todo-func-list` `<ul>`s with tabs + context bar + More/palette triggers; remove the redundant `btn-allFinish`; add the More panel and palette modal markup; bump the `version` meta tag.
- `public/css/style.scss` — append styles for tabs, badges, context bar, More panel, palette; recompile to `style.css` and `style.min.css`.
- `test/logic.test.js` — add tests for `fuzzyMatch` and `searchActions`.
- `CHANGELOG.md`, `README.md`, `ROADMAP.md` — version + notes.

> **Note on TDD scope:** Only the two pure helpers are unit-testable (the repo's test harness is zero-dependency Node with no DOM/jsdom; adding one is out of scope). Task 1 is full TDD. The Vue/markup/CSS tasks are verified by (a) `node test/logic.test.js` still passing (regression guard — it `require()`s `app.js`, so a syntax error there fails the tests), and (b) the manual acceptance checklist in Task 9.

---

## Task 1: Pure action helpers (`fuzzyMatch`, `searchActions`) — TDD

**Files:**
- Modify: `public/js/app.js` (add helpers near other pure helpers, before the Node export hook at line ~176; add to `module.exports`)
- Test: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/logic.test.js`, immediately before the final summary `console.log` line (the file ends with a passed-count log; insert above it). If unsure of the exact tail, append after the last existing `test(...)` block:

```js
// ---- fuzzyMatch ---------------------------------------------------------
test('fuzzyMatch: empty query matches anything', function () {
    assert.strictEqual(core.fuzzyMatch('Sort A-Z', ''), true);
});
test('fuzzyMatch: case-insensitive subsequence match', function () {
    assert.strictEqual(core.fuzzyMatch('Clear Completed', 'clr'), true);
    assert.strictEqual(core.fuzzyMatch('Export file', 'expt'), true);
});
test('fuzzyMatch: non-subsequence fails', function () {
    assert.strictEqual(core.fuzzyMatch('Export', 'zzz'), false);
});
test('fuzzyMatch: null/undefined text and query are safe', function () {
    assert.strictEqual(core.fuzzyMatch(null, ''), true);
    assert.strictEqual(core.fuzzyMatch(undefined, 'a'), false);
});

// ---- searchActions ------------------------------------------------------
test('searchActions: drops unavailable (when === false) actions', function () {
    var acts = [
        { id: 'a', label: 'Sort A-Z', when: true },
        { id: 'b', label: 'Clear All', when: false }
    ];
    var out = core.searchActions(acts, '');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'a');
});
test('searchActions: filters available actions by fuzzy query', function () {
    var acts = [
        { id: 'a', label: 'Sort A-Z', when: true },
        { id: 'b', label: 'Export file', when: true },
        { id: 'c', label: 'Import file', when: true }
    ];
    var out = core.searchActions(acts, 'expt');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'b');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node test/logic.test.js`
Expected: FAIL — `TypeError: core.fuzzyMatch is not a function` (helpers not defined/exported yet).

- [ ] **Step 3: Add the helpers to `public/js/app.js`**

Insert this block just **above** the Node export hook (the `if (typeof module !== 'undefined' && module.exports) {` line, ~176):

```js
    // ---- Command/action helpers (pure, testable) ----
    // Case-insensitive subsequence test: every char of `query` appears in
    // `text` in order. Empty query matches anything.
    function fuzzyMatch(text, query) {
        text = String(text == null ? '' : text).toLowerCase();
        query = String(query == null ? '' : query).toLowerCase().trim();
        if (!query) return true;
        var i = 0;
        for (var j = 0; j < text.length && i < query.length; j++) {
            if (text.charAt(j) === query.charAt(i)) i++;
        }
        return i === query.length;
    }

    // Filter an action list to the available ones (`when !== false`) whose
    // `label` matches `query`. Empty query -> all available. Feeds both the
    // More menu (query '') and the command palette (user query).
    function searchActions(actions, query) {
        return (actions || []).filter(function (a) {
            return a && a.when !== false && fuzzyMatch(a.label, query);
        });
    }
```

Then add both to the existing `module.exports` object (after `genId: genId,`):

```js
            genId: genId,
            fuzzyMatch: fuzzyMatch,
            searchActions: searchActions
```

(Remove the trailing comma issue: ensure the last property has no trailing comma — `searchActions: searchActions` is last.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/logic.test.js`
Expected: PASS — all prior tests plus the 6 new ones print `ok - ...`, and the final summary count increases by 6.

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js test/logic.test.js
git commit -m "feat(menu): add fuzzyMatch + searchActions pure helpers (registry search core)"
```

---

## Task 2: i18n strings for the new menu (EN + ZH)

**Files:**
- Modify: `public/js/i18n.js`

- [ ] **Step 1: Add EN strings**

In the `en:` block, the lines read:

```js
        settingsClose: 'Done',

        defaultSlogan: 'Act Now, Simplify Life.☕'
```

Replace the blank line + `defaultSlogan` so the new keys sit between them:

```js
        settingsClose: 'Done',

        // Menu / tabs / context bar / palette
        moreBtn: 'More',
        moreTitle: 'Actions',
        restoreAll: 'Restore all',
        emptyTrash: 'Empty trash',
        confirmEmptyTrash: 'Permanently delete everything in Trash? This cannot be undone.',
        sectionOrganize: 'Organize',
        sectionCleanup: 'Clean up',
        sectionData: 'Data',
        sectionApp: 'App',
        exportLabel: 'Export',
        importLabel: 'Import',
        channelFile: 'File',
        channelClipboard: 'Clipboard',
        channelPaste: 'Paste',
        paletteTitle: 'Commands',
        palettePlaceholder: 'Search actions…',
        paletteEmpty: 'No matching commands',
        paletteShortcut: '⌘K',

        defaultSlogan: 'Act Now, Simplify Life.☕'
```

- [ ] **Step 2: Add ZH strings**

In the `zh:` block, find:

```js
        settingsClose: '完成',
```

It is followed (a couple lines down) by the ZH `defaultSlogan`. Insert the new keys immediately after `settingsClose: '完成',`:

```js
        settingsClose: '完成',

        // 菜单 / 标签 / 上下文操作 / 命令面板
        moreBtn: '更多',
        moreTitle: '操作',
        restoreAll: '全部还原',
        emptyTrash: '清空回收站',
        confirmEmptyTrash: '永久删除回收站中的所有项目？此操作无法撤销。',
        sectionOrganize: '整理',
        sectionCleanup: '清理',
        sectionData: '数据',
        sectionApp: '应用',
        exportLabel: '导出',
        importLabel: '导入',
        channelFile: '文件',
        channelClipboard: '剪贴板',
        channelPaste: '粘贴',
        paletteTitle: '命令',
        palettePlaceholder: '搜索操作…',
        paletteEmpty: '没有匹配的命令',
        paletteShortcut: '⌘K',
```

(Verify the ZH `defaultSlogan` line still follows and the block stays valid — no duplicate keys, commas correct.)

- [ ] **Step 3: Verify the file parses**

Run: `node -e "var i=require('./public/js/i18n.js'); console.log(i.en.moreBtn, '|', i.zh.moreBtn, '|', i.en.paletteEmpty, '|', i.zh.restoreAll)"`
Expected output: `More | 更多 | No matching commands | 全部还原`

> If `i18n.js` does not export under Node (no `module.exports`), instead verify with: `node -e "require('fs').readFileSync('./public/js/i18n.js','utf8')" ` is not enough — use a syntax check: `node --check public/js/i18n.js` and expect no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add public/js/i18n.js
git commit -m "feat(menu): add i18n strings for tabs, context bar, More menu, palette (EN+ZH)"
```

---

## Task 3: Vue state, action registry, computeds & methods

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add data fields**

In `data()`’s returned object (ends around line 328 with `touchStartY: 0`), add the new fields. Change:

```js
                touchStartX: 0,
                touchStartY: 0
            };
```
to:
```js
                touchStartX: 0,
                touchStartY: 0,
                showMore: false,
                showPalette: false,
                paletteQuery: '',
                paletteIndex: 0
            };
```

- [ ] **Step 2: Add the `paletteQuery` watch**

In the `watch:` block, after the `intention` watcher, add:

```js
            paletteQuery: function () { this.paletteIndex = 0; },
```

- [ ] **Step 3: Add computeds (registry, sections, context, palette results)**

In the `computed:` block, after `themeOptions` (before the closing `}` of `computed`), add a comma after `themeOptions`’s closing brace if needed, then:

```js
            ,
            // Single source of truth for every command. Feeds both the More
            // menu and the command palette. `when` controls availability.
            actions: function () {
                var self = this, t = this.t;
                return [
                    { id: 'sort',     label: t.sortAZ,           icon: '↕',  section: 'organize', when: this.todos.length > 1,         run: function () { self.sortAZ(); } },
                    { id: 'finishAll',label: t.finishAll,        icon: '✓',  section: 'organize', when: this.leftTodosCount > 0,       run: function () { self.markAllAsCompleted(); } },
                    { id: 'clearCompleted', label: t.clearCompletedBtn, icon: '🧹', section: 'cleanup', when: this.completedTodosCount > 0, run: function () { self.clearCompleted(); } },
                    { id: 'clearAll', label: t.clearAllBtn,      icon: '🗑', section: 'cleanup', danger: true, when: this.todos.length > 0, run: function () { self.clearAll(); } },
                    { id: 'bulkAdd',  label: t.bulkAdd,          icon: '＋', section: 'data',     when: true,                          run: function () { self.openBulk(); } },
                    { id: 'exportFile', label: t.exportFile,     icon: '⤓',  section: 'data',     when: true,                          run: function () { self.exportFile(); } },
                    { id: 'copy',     label: t.copyClipboard,    icon: '⧉',  section: 'data',     when: true,                          run: function () { self.copyToClipboard(); } },
                    { id: 'importFile', label: t.importFile,     icon: '⤒',  section: 'data',     when: true,                          run: function () { self.importFile(); } },
                    { id: 'paste',    label: t.pasteClipboard,   icon: '⎘',  section: 'data',     when: true,                          run: function () { self.pasteFromClipboard(); } },
                    { id: 'settings', label: t.settings,         icon: '⚙',  section: 'app',      when: true,                          run: function () { self.openSettings(); } },
                    { id: 'reload',   label: t.reload,           icon: '⟳',  section: 'app',      when: true,                          run: function () { location.reload(); } }
                ];
            },
            // Grouped available actions for the More menu (Data is rendered
            // separately as intent-paired rows, so it is excluded here).
            moreSections: function () {
                var avail = searchActions(this.actions, '');
                var defs = [
                    { key: 'organize', title: this.t.sectionOrganize },
                    { key: 'cleanup',  title: this.t.sectionCleanup },
                    { key: 'app',      title: this.t.sectionApp }
                ];
                return defs.map(function (d) {
                    return {
                        key: d.key, title: d.title,
                        items: avail.filter(function (a) { return a.section === d.key; })
                    };
                });
            },
            // The one (or two) bulk actions relevant to the current filter view.
            contextActions: function () {
                var self = this, t = this.t;
                if (this.intention === 'completed') {
                    return this.completedTodosCount > 0
                        ? [{ id: 'ctx-clearCompleted', label: t.clearCompletedBtn, run: function () { self.clearCompleted(); } }]
                        : [];
                }
                if (this.intention === 'removed') {
                    return this.recycleBin.length > 0
                        ? [
                            { id: 'ctx-restoreAll', label: t.restoreAll, run: function () { self.restoreAll(); } },
                            { id: 'ctx-emptyTrash', label: t.emptyTrash, danger: true, run: function () { self.emptyTrash(); } }
                          ]
                        : [];
                }
                // all / ongoing
                return this.leftTodosCount > 0
                    ? [{ id: 'ctx-finishAll', label: t.finishAll, run: function () { self.markAllAsCompleted(); } }]
                    : [];
            },
            // Available actions filtered by the palette query.
            paletteResults: function () {
                return searchActions(this.actions, this.paletteQuery);
            }
```

> Implementation note: `searchActions` is the module-scope helper from Task 1 and is in lexical scope here (same IIFE), so it is called bare — **not** `this.searchActions`.

- [ ] **Step 4: Add methods**

In the `methods:` block, replace the final method `setTheme`:

```js
            setTheme: function (name) { this.theme = name; }
```
with `setTheme` plus all the new methods:
```js
            setTheme: function (name) { this.theme = name; },

            // ---- Trash bulk ops (used by the context bar) ----
            restoreAll: function () {
                var self = this;
                this.recycleBin.slice().forEach(function (todo) {
                    todo.removed = false;
                    self.todos.push(todo);
                });
                this.recycleBin = [];
                this.intention = 'all';
            },
            emptyTrash: function () {
                var self = this;
                confirm(this.t.confirmEmptyTrash).then(function (ok) {
                    if (ok) { self.recycleBin = []; self.intention = 'all'; }
                });
            },

            // ---- More menu + command palette ----
            byId: function (id) {
                var a = this.actions;
                for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
                return null;
            },
            openMore: function () { this.showMore = true; },
            closeMore: function () { this.showMore = false; },
            runAction: function (a) {
                this.closeMore();
                this.closePalette();
                if (a && typeof a.run === 'function') a.run();
            },
            openPalette: function () {
                this.paletteQuery = '';
                this.paletteIndex = 0;
                this.showPalette = true;
                var self = this;
                this.$nextTick(function () {
                    if (self.$refs.paletteInput) self.$refs.paletteInput.focus();
                });
            },
            closePalette: function () { this.showPalette = false; },
            paletteMove: function (delta) {
                var n = this.paletteResults.length;
                if (!n) return;
                this.paletteIndex = (this.paletteIndex + delta + n) % n;
            },
            paletteEnter: function () {
                var a = this.paletteResults[this.paletteIndex];
                if (a) this.runAction(a);
            },
            onKeydown: function (e) {
                // Cmd/Ctrl+K toggles the palette from anywhere.
                if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                    e.preventDefault();
                    if (this.showPalette) this.closePalette(); else this.openPalette();
                    return;
                }
                if (e.key === 'Escape') {
                    if (this.showPalette) { this.closePalette(); return; }
                    if (this.showMore) { this.closeMore(); return; }
                }
                if (!this.showPalette) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); this.paletteMove(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); this.paletteMove(-1); }
                else if (e.key === 'Enter') { e.preventDefault(); this.paletteEnter(); }
            }
```

- [ ] **Step 5: Register/unregister the global key handler**

In `mounted()`, after the existing body (after the `window.onresize = ...` assignment, before the closing `}`), add:

```js
            document.addEventListener('keydown', this.onKeydown);
```

Then add a `beforeDestroy` hook. The instance currently ends:

```js
        mounted: function () {
            ...
        }
    });
```
Change the close of `mounted` to add `beforeDestroy` after it:
```js
        mounted: function () {
            ...
            document.addEventListener('keydown', this.onKeydown);
        },
        beforeDestroy: function () {
            document.removeEventListener('keydown', this.onKeydown);
        }
    });
```

> `this.onKeydown` is an instance-bound Vue method, so the same reference is used for add/remove.

- [ ] **Step 6: Syntax-check + regression test**

Run: `node --check public/js/app.js`
Expected: no output, exit 0.

Run: `node test/logic.test.js`
Expected: PASS (all tests, including Task 1’s — this confirms `app.js` still loads cleanly).

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat(menu): add action registry, context actions, More + palette state/methods"
```

---

## Task 4: Rebuild the menu markup in `index.html` (EN)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Remove the redundant "Mark All Done" button**

Delete this block (the `btn-allFinish` input, ~lines 85–90), since its job moves to the context bar:

```html
                            <input
                                type="button"
                                class="btn btn-label btn-allFinish"
                                :value="t.markAllDone"
                                @click="markAllAsCompleted"
                                v-if="todos.length || recycleBin.length"/>
```

(Leave the surrounding `<div class="bar-message">` and the slogan `<template>` intact.)

- [ ] **Step 2: Replace the three func-lists with tabs + context bar + triggers**

Replace the entire block from `<ul class="todo-func-list filter">` through its three closing `</ul>`s (the contents of `<div class="todo-footer-box">`, ~lines 217–336) with:

```html
                            <!-- Filters as segmented tabs -->
                            <div class="todo-tabs" role="tablist">
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='all'}" @click="intention='all'">
                                    <span class="tab-label">{{ t.filterAll }}</span>
                                    <span class="tab-badge">{{ todos.length }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='ongoing'}" @click="intention='ongoing'">
                                    <span class="tab-label">{{ t.filterOngoing }}</span>
                                    <span class="tab-badge">{{ leftTodosCount }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='completed'}" @click="intention='completed'">
                                    <span class="tab-label">{{ t.filterCompleted }}</span>
                                    <span class="tab-badge">{{ completedTodosCount }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab" v-if="recycleBin.length"
                                    :class="{selected: intention==='removed'}" @click="intention='removed'">
                                    <span class="tab-label">{{ t.filterTrash }}</span>
                                    <span class="tab-badge">{{ recycleBin.length }}</span>
                                </button>
                            </div>

                            <!-- Context-aware bulk action(s) for the current view -->
                            <div class="context-bar" v-if="contextActions.length">
                                <button type="button" v-for="a in contextActions" :key="a.id"
                                    class="context-btn" :class="{danger: a.danger}" @click="a.run()">{{ a.label }}</button>
                            </div>

                            <!-- More menu + command palette triggers -->
                            <div class="todo-actions-foot">
                                <button type="button" class="more-btn" @click="openMore">⋯ {{ t.moreBtn }}</button>
                                <button type="button" class="palette-btn" @click="openPalette" :title="t.paletteTitle">{{ t.paletteShortcut }}</button>
                            </div>
```

- [ ] **Step 3: Add the More panel + palette modal markup**

Immediately after the Settings modal’s closing `</div>` (the `<!-- Settings modal -->` overlay block, ~line 386) and before `<!-- Custom Info -->`, insert:

```html
                <!-- More actions panel -->
                <div class="ui-modal-overlay more-overlay" v-if="showMore" @click.self="closeMore">
                    <div class="more-panel">
                        <div class="more-head">
                            <span class="more-title">{{ t.moreTitle }}</span>
                            <button type="button" class="more-close" @click="closeMore" aria-label="Close">×</button>
                        </div>
                        <div class="more-section" v-for="sec in moreSections" :key="sec.key" v-if="sec.items.length">
                            <div class="more-section-title">{{ sec.title }}</div>
                            <button type="button" v-for="a in sec.items" :key="a.id"
                                class="more-item" :class="{danger: a.danger}" @click="runAction(a)">
                                <span class="more-ico">{{ a.icon }}</span><span>{{ a.label }}</span>
                            </button>
                        </div>
                        <div class="more-section">
                            <div class="more-section-title">{{ t.sectionData }}</div>
                            <button type="button" class="more-item" @click="runAction(byId('bulkAdd'))">
                                <span class="more-ico">＋</span><span>{{ t.bulkAdd }}</span>
                            </button>
                            <div class="more-pair">
                                <span class="more-pair-label">{{ t.exportLabel }}</span>
                                <button type="button" class="more-chip" @click="runAction(byId('exportFile'))">{{ t.channelFile }}</button>
                                <button type="button" class="more-chip" @click="runAction(byId('copy'))">{{ t.channelClipboard }}</button>
                            </div>
                            <div class="more-pair">
                                <span class="more-pair-label">{{ t.importLabel }}</span>
                                <button type="button" class="more-chip" @click="runAction(byId('importFile'))">{{ t.channelFile }}</button>
                                <button type="button" class="more-chip" @click="runAction(byId('paste'))">{{ t.channelPaste }}</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Command palette -->
                <div class="ui-modal-overlay palette-overlay" v-if="showPalette" @click.self="closePalette">
                    <div class="palette">
                        <input ref="paletteInput" type="text" class="palette-input"
                            v-model="paletteQuery" :placeholder="t.palettePlaceholder"/>
                        <ul class="palette-list" v-if="paletteResults.length">
                            <li v-for="(a, i) in paletteResults" :key="a.id"
                                class="palette-item" :class="{active: i===paletteIndex, danger: a.danger}"
                                @click="runAction(a)" @mouseenter="paletteIndex = i">
                                <span class="palette-ico">{{ a.icon }}</span>
                                <span class="palette-label">{{ a.label }}</span>
                            </li>
                        </ul>
                        <div class="palette-empty" v-else>{{ t.paletteEmpty }}</div>
                    </div>
                </div>
```

- [ ] **Step 4: Bump the version meta tag**

Change line 7:
```html
        <meta name="version" content="1.1.0">
```
to:
```html
        <meta name="version" content="1.2.0">
```

- [ ] **Step 5: Sanity-check the markup**

Run: `node -e "var s=require('fs').readFileSync('index.html','utf8'); ['todo-tabs','context-bar','more-panel','palette-input','more-pair'].forEach(function(c){ if(s.indexOf(c)<0) throw new Error('missing '+c); }); if(s.indexOf('btn-allFinish')>=0) throw new Error('btn-allFinish not removed'); console.log('index.html markup OK');"`
Expected: `index.html markup OK`

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(menu): rebuild EN menu markup — tabs, context bar, More panel, palette"
```

---

## Task 5: Mirror the menu markup in `index-zh.html` (ZH)

**Files:**
- Modify: `index-zh.html`

> The Vue template is identical to `index.html` (it uses `t.*` keys, so no Chinese literals are in the markup). Apply the same four edits, locating the ZH file’s own anchors.

- [ ] **Step 1: Remove the redundant "Mark All Done" button**

Find and delete the `btn-allFinish` input block in `index-zh.html` (same markup as Task 4 Step 1):

```html
                            <input
                                type="button"
                                class="btn btn-label btn-allFinish"
                                :value="t.markAllDone"
                                @click="markAllAsCompleted"
                                v-if="todos.length || recycleBin.length"/>
```

- [ ] **Step 2: Replace the three func-lists**

In `index-zh.html`, replace the block from `<ul class="todo-func-list filter">` through its three closing `</ul>`s inside `<div class="todo-footer-box">` with the exact same tabs + context bar + triggers markup from **Task 4 Step 2**:

```html
                            <!-- Filters as segmented tabs -->
                            <div class="todo-tabs" role="tablist">
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='all'}" @click="intention='all'">
                                    <span class="tab-label">{{ t.filterAll }}</span>
                                    <span class="tab-badge">{{ todos.length }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='ongoing'}" @click="intention='ongoing'">
                                    <span class="tab-label">{{ t.filterOngoing }}</span>
                                    <span class="tab-badge">{{ leftTodosCount }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab"
                                    :class="{selected: intention==='completed'}" @click="intention='completed'">
                                    <span class="tab-label">{{ t.filterCompleted }}</span>
                                    <span class="tab-badge">{{ completedTodosCount }}</span>
                                </button>
                                <button type="button" class="todo-tab" role="tab" v-if="recycleBin.length"
                                    :class="{selected: intention==='removed'}" @click="intention='removed'">
                                    <span class="tab-label">{{ t.filterTrash }}</span>
                                    <span class="tab-badge">{{ recycleBin.length }}</span>
                                </button>
                            </div>

                            <!-- Context-aware bulk action(s) for the current view -->
                            <div class="context-bar" v-if="contextActions.length">
                                <button type="button" v-for="a in contextActions" :key="a.id"
                                    class="context-btn" :class="{danger: a.danger}" @click="a.run()">{{ a.label }}</button>
                            </div>

                            <!-- More menu + command palette triggers -->
                            <div class="todo-actions-foot">
                                <button type="button" class="more-btn" @click="openMore">⋯ {{ t.moreBtn }}</button>
                                <button type="button" class="palette-btn" @click="openPalette" :title="t.paletteTitle">{{ t.paletteShortcut }}</button>
                            </div>
```

- [ ] **Step 3: Add the More panel + palette modal markup**

In `index-zh.html`, immediately after the Settings modal overlay block and before `<!-- Custom Info -->`, insert the exact same markup from **Task 4 Step 3** (the `more-overlay` block and the `palette-overlay` block). Reproduced:

```html
                <!-- More actions panel -->
                <div class="ui-modal-overlay more-overlay" v-if="showMore" @click.self="closeMore">
                    <div class="more-panel">
                        <div class="more-head">
                            <span class="more-title">{{ t.moreTitle }}</span>
                            <button type="button" class="more-close" @click="closeMore" aria-label="Close">×</button>
                        </div>
                        <div class="more-section" v-for="sec in moreSections" :key="sec.key" v-if="sec.items.length">
                            <div class="more-section-title">{{ sec.title }}</div>
                            <button type="button" v-for="a in sec.items" :key="a.id"
                                class="more-item" :class="{danger: a.danger}" @click="runAction(a)">
                                <span class="more-ico">{{ a.icon }}</span><span>{{ a.label }}</span>
                            </button>
                        </div>
                        <div class="more-section">
                            <div class="more-section-title">{{ t.sectionData }}</div>
                            <button type="button" class="more-item" @click="runAction(byId('bulkAdd'))">
                                <span class="more-ico">＋</span><span>{{ t.bulkAdd }}</span>
                            </button>
                            <div class="more-pair">
                                <span class="more-pair-label">{{ t.exportLabel }}</span>
                                <button type="button" class="more-chip" @click="runAction(byId('exportFile'))">{{ t.channelFile }}</button>
                                <button type="button" class="more-chip" @click="runAction(byId('copy'))">{{ t.channelClipboard }}</button>
                            </div>
                            <div class="more-pair">
                                <span class="more-pair-label">{{ t.importLabel }}</span>
                                <button type="button" class="more-chip" @click="runAction(byId('importFile'))">{{ t.channelFile }}</button>
                                <button type="button" class="more-chip" @click="runAction(byId('paste'))">{{ t.channelPaste }}</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Command palette -->
                <div class="ui-modal-overlay palette-overlay" v-if="showPalette" @click.self="closePalette">
                    <div class="palette">
                        <input ref="paletteInput" type="text" class="palette-input"
                            v-model="paletteQuery" :placeholder="t.palettePlaceholder"/>
                        <ul class="palette-list" v-if="paletteResults.length">
                            <li v-for="(a, i) in paletteResults" :key="a.id"
                                class="palette-item" :class="{active: i===paletteIndex, danger: a.danger}"
                                @click="runAction(a)" @mouseenter="paletteIndex = i">
                                <span class="palette-ico">{{ a.icon }}</span>
                                <span class="palette-label">{{ a.label }}</span>
                            </li>
                        </ul>
                        <div class="palette-empty" v-else>{{ t.paletteEmpty }}</div>
                    </div>
                </div>
```

- [ ] **Step 4: Bump the version meta tag**

In `index-zh.html` (line ~9), change `content="1.1.0"` to `content="1.2.0"` on the `<meta name="version" ...>` tag.

- [ ] **Step 5: Sanity-check the markup**

Run: `node -e "var s=require('fs').readFileSync('index-zh.html','utf8'); ['todo-tabs','context-bar','more-panel','palette-input','more-pair'].forEach(function(c){ if(s.indexOf(c)<0) throw new Error('missing '+c); }); if(s.indexOf('btn-allFinish')>=0) throw new Error('btn-allFinish not removed'); if(s.indexOf('content=\"1.2.0\"')<0) throw new Error('version not bumped'); console.log('index-zh.html markup OK');"`
Expected: `index-zh.html markup OK`

- [ ] **Step 6: Commit**

```bash
git add index-zh.html
git commit -m "feat(menu): mirror new menu markup + version bump in index-zh.html"
```

---

## Task 6: Styles for tabs, context bar, More panel & palette

**Files:**
- Modify: `public/css/style.scss`
- Regenerate: `public/css/style.css`, `public/css/style.min.css`

- [ ] **Step 1: Append the new styles to `style.scss`**

Append at the end of `public/css/style.scss`:

```scss
/* ===== Right-side menu UX (v1.2.0): tabs, context bar, More, palette ===== */

.todo-tabs {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 156px;
}
.todo-tab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    border-top: 1px solid var(--black);
    background: transparent;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
}
.todo-tab:first-child { border-top: 0; }
.todo-tab:hover { background: var(--completed); }
.todo-tab.selected { background: var(--normal); font-weight: 700; }
.tab-badge {
    min-width: 20px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(51, 50, 46, 0.12);
    font-size: 12px;
    font-weight: 700;
    text-align: center;
}
.todo-tab.selected .tab-badge { background: rgba(51, 50, 46, 0.22); }

.context-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-top: var(--border);
    background: rgba(51, 50, 46, 0.04);
}
.context-btn {
    width: 100%;
    padding: 8px 12px;
    border: var(--border);
    border-radius: var(--border-radius);
    background: var(--normal);
    color: var(--font-color);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
}
.context-btn:hover { box-shadow: var(--box-shadow); transform: translate(-1px, -1px); }
.context-btn.danger { background: var(--deleted); }

.todo-actions-foot {
    display: flex;
    align-items: stretch;
    gap: 6px;
    padding: 10px;
    border-top: var(--border);
}
.more-btn {
    flex: 1 1 auto;
    padding: 9px 12px;
    border: var(--border);
    border-radius: var(--border-radius);
    background: #fff;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
}
.more-btn:hover { box-shadow: var(--box-shadow); transform: translate(-1px, -1px); }
.palette-btn {
    flex: 0 0 auto;
    padding: 9px 10px;
    border: var(--border);
    border-radius: var(--border-radius);
    background: #fff;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}
.palette-btn:hover { box-shadow: var(--box-shadow); transform: translate(-1px, -1px); }

/* More panel (reuses .ui-modal-overlay) */
.more-panel {
    background: var(--bg-normal);
    border: var(--border);
    border-radius: var(--border-radius);
    box-shadow: var(--box-shadow);
    width: 100%;
    max-width: 360px;
    padding: 18px;
    font-family: var(--font);
    box-sizing: border-box;
    animation: popIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}
.more-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.more-title { font-size: 18px; font-weight: 800; color: var(--font-color); }
.more-close { border: 0; background: transparent; font-size: 24px; line-height: 1; cursor: pointer; color: var(--font-color); }
.more-section { margin-top: 12px; }
.more-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--placeholder); margin-bottom: 6px; }
.more-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border: 0;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
}
.more-item:hover { background: var(--completed); }
.more-item.danger { color: #b23b2e; }
.more-item.danger:hover { background: var(--deleted); }
.more-ico { width: 20px; text-align: center; }
.more-pair { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.more-pair-label { flex: 1 1 auto; font-size: 15px; color: var(--font-color); }
.more-chip {
    padding: 5px 12px;
    border: var(--border);
    border-radius: var(--border-radius);
    background: #fff;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
}
.more-chip:hover { box-shadow: var(--box-shadow); transform: translate(-1px, -1px); }

/* Command palette (reuses .ui-modal-overlay) */
.palette-overlay { align-items: flex-start; }
.palette {
    margin-top: 12vh;
    width: 100%;
    max-width: 480px;
    background: var(--bg-normal);
    border: var(--border);
    border-radius: var(--border-radius);
    box-shadow: var(--box-shadow);
    overflow: hidden;
    font-family: var(--font);
    animation: popIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}
.palette-input {
    width: 100%;
    box-sizing: border-box;
    padding: 14px 16px;
    border: 0;
    border-bottom: var(--border);
    background: #fff;
    color: var(--font-color);
    font-family: var(--font);
    font-size: 16px;
    outline: none;
}
.palette-list { list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow-y: auto; }
.palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--border-radius);
    cursor: pointer;
    color: var(--font-color);
}
.palette-item.active { background: var(--normal); }
.palette-item.danger { color: #b23b2e; }
.palette-ico { width: 20px; text-align: center; }
.palette-label { flex: 1 1 auto; }
.palette-empty { padding: 20px 16px; text-align: center; color: var(--placeholder); }

/* Mobile: render More + palette as bottom sheets */
@include respond-to('md') {
    .more-overlay, .palette-overlay { align-items: flex-end; padding: 0; }
    .more-panel, .palette {
        max-width: 100%;
        margin: 0;
        border-radius: var(--border-radius) var(--border-radius) 0 0;
        border-bottom: 0;
    }
    .palette-list { max-height: 50vh; }
}
```

- [ ] **Step 2: Recompile CSS (both outputs)**

Run:
```bash
sass public/css/style.scss public/css/style.css --no-source-map && \
sass public/css/style.scss public/css/style.min.css --style compressed --no-source-map
```
Expected: no errors, exit 0.

- [ ] **Step 3: Verify the compiled CSS contains the new classes**

Run: `grep -c "todo-tab\|context-btn\|more-panel\|palette-input" public/css/style.min.css`
Expected: a non-zero count (≥ 4).

- [ ] **Step 4: Commit**

```bash
git add public/css/style.scss public/css/style.css public/css/style.min.css
git commit -m "feat(menu): styles for segmented tabs, context bar, More panel, command palette"
```

---

## Task 7: Version bump in `app.js` + docs

**Files:**
- Modify: `public/js/app.js`, `CHANGELOG.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Bump `APP_VERSION`**

In `public/js/app.js` line ~19, change:
```js
    var APP_VERSION = '1.1.0';
```
to:
```js
    var APP_VERSION = '1.2.0';
```

- [ ] **Step 2: Update the Task 1 version assertion (if present)**

Check whether `test/logic.test.js` asserts `APP_VERSION`. Run: `grep -n "APP_VERSION" test/logic.test.js`. If a test asserts `=== '1.1.0'`, update it to `'1.2.0'`. If there is no such assertion, skip.

- [ ] **Step 3: Add a CHANGELOG entry**

In `CHANGELOG.md`, add a new section directly under the top title block, above `## [1.1.0] — 2026-06-11`:

```markdown
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
```

- [ ] **Step 4: Update README (feature list)**

In `README.md`, locate the feature/usage section that lists app capabilities (search for "Settings" or "Theme" or the features list). Add a concise bullet near the existing feature notes:

```markdown
- **Reorganized menu:** filter tabs with counts, a context-aware action bar,
  a "More" menu, and a ⌘K command palette.
```

If no obvious feature list exists, add a short `## Features` note with that bullet above the usage instructions. Keep it brief and consistent with the surrounding tone (the README is bilingual; place the English bullet in the English `## Intro`/usage area).

- [ ] **Step 5: Update ROADMAP**

In `ROADMAP.md`, update the "Last updated" line near the top to reference **v1.2.0 (2026-06-12) — right-side menu UX overhaul**, and if there is a phase/status list, add a one-line entry noting the menu overhaul shipped (tabs + context bar + More menu + command palette). Keep it to 1–2 lines; do not restructure the document.

- [ ] **Step 6: Verify versions are consistent**

Run:
```bash
grep -n "1.2.0" public/js/app.js index.html index-zh.html | cat
node -e "var c=require('./public/js/app.js'); console.log('APP_VERSION', c.APP_VERSION);"
```
Expected: the meta tags (both HTML) and `APP_VERSION` all show `1.2.0`; the node line prints `APP_VERSION 1.2.0`.

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js test/logic.test.js CHANGELOG.md README.md ROADMAP.md
git commit -m "chore: bump to v1.2.0 and update CHANGELOG / README / ROADMAP"
```

---

## Task 8: Full regression + manual acceptance

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `node test/logic.test.js`
Expected: all tests pass (including the 6 added in Task 1); non-zero passed count, no `AssertionError`.

- [ ] **Step 2: Syntax-check all JS/HTML touch points**

Run:
```bash
node --check public/js/app.js && node --check public/js/i18n.js && echo "JS OK"
```
Expected: `JS OK`.

- [ ] **Step 3: Manual acceptance (open `index.html` in a browser)**

Verify each, in both `index.html` and `index-zh.html`:
- Tabs switch the view; the selected tab is highlighted; badges show correct counts; **In Progress** and **Completed** stay visible at 0; **Trash** appears only when items are deleted.
- Context bar: on All/In Progress with incomplete items → **Finish all** works; on Completed → **Clear completed** (confirms) works; on Trash → **Restore all** and **Empty trash** (confirms) work and return you to All.
- **More** opens the panel; Sort, Clear All (confirms + destructive style), Add many, Export (File/Clipboard), Import (File/Paste), Settings, Reload all work; clicking outside or Esc closes it.
- **⌘K / Ctrl-K** opens the palette; typing filters; ↑/↓ move the highlight; Enter runs; Esc closes; the ⌘K hint button also opens it.
- No leftover "Mark All Done" button in the bar-message area.
- No console errors on load or interaction.

- [ ] **Step 4: Theme + responsive spot-check**

- Switch to **Dark** and **High Contrast** in Settings; confirm tabs, context bar, More panel, and palette are readable (selected/badge/danger states visible).
- Narrow the window below 768px (or use device emulation): the sidebar reflows to the bottom-right; the More panel and palette render as bottom sheets; everything is tap-reachable.

- [ ] **Step 5: Final commit (only if Step 3/4 required fixes)**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix(menu): address manual-acceptance findings"
```

---

## Self-Review notes (author)

- **Spec coverage:** tabs (Task 4/5/6), stability via always-shown tabs (Task 4 markup), context bar incl. Restore all/Empty trash (Tasks 3–6), More menu with intent-paired Export/Import (Tasks 3–6), command palette (Tasks 3–6), single registry feeding both surfaces (Task 3), reuse of existing methods (Task 3), EN/ZH lock-step (Tasks 2,4,5), tests (Task 1), version+docs (Task 7), reliability: Esc/outside-click/listener cleanup (Task 3). All spec sections map to tasks.
- **Deviation from spec (intentional):** More menu and palette are centered **modal overlays** (reusing the proven `.ui-modal-overlay` pattern), styled as **bottom sheets** on mobile, rather than a desktop popover anchored to the floating sidebar — this is more reliable and matches existing patterns (the spec's "popover" was a presentation detail, not a requirement).
- **Type consistency:** method/computed names (`actions`, `moreSections`, `contextActions`, `paletteResults`, `byId`, `runAction`, `openMore`/`closeMore`, `openPalette`/`closePalette`, `paletteMove`, `paletteEnter`, `onKeydown`, `restoreAll`, `emptyTrash`) are used identically across JS and markup; i18n keys referenced in markup (`moreBtn`, `moreTitle`, `sectionData`, `exportLabel`, `importLabel`, `channelFile/Clipboard/Paste`, `palettePlaceholder`, `paletteEmpty`, `paletteShortcut`, `paletteTitle`, `restoreAll`, `emptyTrash`, `confirmEmptyTrash`) all defined in Task 2.
