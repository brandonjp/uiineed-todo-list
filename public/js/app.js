/*
 * app.js — shared logic for the Uiineed Todo List (English + Chinese pages).
 *
 * Both index.html and index-zh.html load this same file. The page sets
 * `window.UIINEED_LANG` ('en' | 'zh') before loading; everything else (storage,
 * dialogs, import/export, the Vue instance) lives here so behavior is defined once.
 *
 * Templates stay in each HTML file (their author/About sections differ on purpose),
 * but all user-facing text is pulled from i18n.js via the `t` / `tf` helpers.
 *
 * The pure data helpers (parse/merge/dedupe/normalize) are also exported under
 * Node (see the "Node test hook" below) so test/logic.test.js can exercise the
 * real code with no browser. In a browser that hook is skipped — behavior there
 * is unchanged.
 */
(function () {
    'use strict';

    var APP_VERSION = '1.7.1';

    var HAS_DOM = (typeof window !== 'undefined' && typeof document !== 'undefined');
    var ACTIVE_LANG = (HAS_DOM && window.UIINEED_LANG === 'zh') ? 'zh' : 'en';
    var I18N = (typeof window !== 'undefined' && window.I18N) || {};
    var L = I18N[ACTIVE_LANG] || I18N.en || {};

    // ---- Storage keys -------------------------------------------------------
    var STORAGE_KEY = 'uiineed-todos';
    var RECYCLE_KEY = 'uiineed-recycle';
    var FILTER_KEY = 'uiineed-filter';
    var SORT_KEY = 'uiineed-sort';          // local view pref: { mode, randomOrder } — NOT synced
    var SLOGAN_KEY = 'uiineed-slogan';
    var SETTINGS_KEY = 'uiineed-settings';
    var SYNC_KEY = 'uiineed-sync';          // local sync meta: { updatedAt, synced }
    var SYNC_ENDPOINT = 'sync.php';         // SAME-ORIGIN, relative — never hardcode a host

    // ---- Settings + theme ---------------------------------------------------
    var THEMES = ['classic', 'dark', 'sepia', 'ocean', 'contrast', 'pastel', 'auto'];

    function loadSettings() {
        try {
            var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            return { theme: THEMES.indexOf(s.theme) >= 0 ? s.theme : 'classic' };
        } catch (e) {
            return { theme: 'classic' };
        }
    }

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

    function effectiveTheme(theme) {
        if (theme === 'auto') {
            var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return dark ? 'dark' : 'classic';
        }
        return theme;
    }

    function applyTheme(theme) {
        var resolved = effectiveTheme(theme);
        if (resolved === 'classic') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', resolved);
        }
    }

    // ---- Stable unique IDs (BUG-2) -----------------------------------------
    // IDs are generated once at creation and persisted, so they stay stable
    // across reloads and unique across the todos + recycle-bin partition.
    var _idCounter = 0;
    function genId() {
        return 't' + Date.now().toString(36) + '-' + (_idCounter++).toString(36);
    }

    // ---- Normalization / parsing -------------------------------------------
    function coerce(item) {
        if (item == null) return { id: null, title: '', completed: false, removed: false };
        if (typeof item === 'string') return { id: null, title: item, completed: false, removed: false };
        return {
            id: item.id != null ? item.id : null,
            title: typeof item.title === 'string' ? item.title : (item.title != null ? String(item.title) : ''),
            completed: !!item.completed,
            removed: !!item.removed
        };
    }

    function fetchRaw(key) {
        try {
            var v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) {
            return [];
        }
    }

    // Load todos + recycle bin, guaranteeing every id is present and unique.
    function loadState() {
        var todos = fetchRaw(STORAGE_KEY).map(coerce);
        var recycle = fetchRaw(RECYCLE_KEY).map(coerce);
        var seen = {};
        function fix(list, removedFlag) {
            list.forEach(function (t) {
                if (t.id == null || seen[t.id] != null) t.id = genId();
                seen[t.id] = true;
                t.removed = removedFlag;
            });
        }
        fix(todos, false);
        fix(recycle, true);
        backfillCreatedAt(todos);
        backfillCreatedAt(recycle);
        return { todos: todos, recycle: recycle };
    }

    // Writes that tolerate storage being full or disabled (e.g. Safari private
    // mode) without throwing inside a Vue watcher and breaking reactivity.
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (e) { return false; }
    }

    var todoStorage = {
        save: function (todos) { safeSet(STORAGE_KEY, JSON.stringify(todos)); }
    };
    var recycleStorage = {
        save: function (items) { safeSet(RECYCLE_KEY, JSON.stringify(items)); }
    };

    // ---- Sync meta (local bookkeeping for cross-device sync) ----------------
    // updatedAt: logical timestamp of the current local data version (bumped on
    // every local change). synced: have we ever reconciled with the backend on
    // this device (controls the safe first-contact union — see planSync).
    function loadSyncMeta() {
        try {
            var s = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
            return {
                updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
                synced: !!s.synced
            };
        } catch (e) {
            return { updatedAt: 0, synced: false };
        }
    }
    function saveSyncMeta(m) { safeSet(SYNC_KEY, JSON.stringify(m)); }

    // Coerce a remote list into clean todos, preserving createdAt (so newest/
    // oldest sort still works after a pull) and backfilling any that lack one.
    function sanitizeRemoteList(arr) {
        var out = (Array.isArray(arr) ? arr : []).map(function (it) {
            var c = coerce(it);
            if (it && typeof it.createdAt === 'number') c.createdAt = it.createdAt;
            return c;
        });
        backfillCreatedAt(out);
        return out;
    }

    // ---- Custom dialogs (SEC-1: text set via textContent, never innerHTML) --
    function buildDialog(message, opts) {
        return new Promise(function (resolve) {
            // Reuse the styled modal system (.ui-modal-*) that the static
            // bulk/paste/settings modals use — these are the classes that
            // actually exist in the stylesheet. The buttons keep the
            // .custom-alert-btn cancel/confirm classes, matching those modals.
            var overlay = document.createElement('div');
            overlay.className = 'ui-modal-overlay';
            var box = document.createElement('div');
            box.className = 'ui-modal';

            var titleEl = document.createElement('div');
            titleEl.className = 'ui-modal-title';
            titleEl.textContent = opts.title;
            box.appendChild(titleEl);

            var contentEl = document.createElement('div');
            contentEl.className = 'ui-modal-hint';
            contentEl.textContent = message;
            box.appendChild(contentEl);

            var btnWrap = document.createElement('div');
            btnWrap.className = 'ui-modal-buttons';
            opts.buttons.forEach(function (b) {
                var btn = document.createElement('button');
                btn.className = 'custom-alert-btn ' + b.cls;
                btn.textContent = b.label;
                btn.addEventListener('click', function () {
                    box.style.animation = 'popOut 0.3s forwards';
                    setTimeout(function () {
                        if (overlay.parentNode) document.body.removeChild(overlay);
                        resolve(b.value);
                    }, 300);
                });
                btnWrap.appendChild(btn);
            });
            box.appendChild(btnWrap);

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            overlay.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var c = box.querySelector('.cancel') || box.querySelector('.confirm');
                    if (c) c.click();
                }
            });
            var focusBtn = box.querySelector('.cancel') || box.querySelector('.confirm');
            if (focusBtn) focusBtn.focus();
        });
    }

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

    // Recover the creation timestamp baked into a genId-format id
    // ('t' + base36(Date.now()) + '-' + base36(counter)). Returns ms, or null
    // for ids not in that shape (imported/legacy) so they can sort to the end.
    function idTime(id) {
        if (typeof id !== 'string') return null;
        var m = /^t([0-9a-z]+)-[0-9a-z]+$/.exec(id);
        if (!m) return null;
        var t = parseInt(m[1], 36);
        return isNaN(t) ? null : t;
    }

    // Pure one-shot sort. Returns a NEW array of the same todo references in
    // the requested order. modes: 'az' | 'za' | 'newest' | 'oldest'.
    // Order key: createdAt if present, else the id timestamp; items with no
    // signal keep their stored position. Original index is the stable tiebreak.
    function sortTodos(list, mode) {
        var decorated = (list || []).map(function (todo, i) {
            var key = (todo && typeof todo.createdAt === 'number') ? todo.createdAt : idTime(todo && todo.id);
            return { todo: todo, i: i, key: key };
        });
        decorated.sort(function (a, b) {
            if (mode === 'az') return String(a.todo.title || '').localeCompare(String(b.todo.title || '')) || (a.i - b.i);
            if (mode === 'za') return String(b.todo.title || '').localeCompare(String(a.todo.title || '')) || (a.i - b.i);
            var ak = a.key, bk = b.key;
            if (ak == null && bk == null) return a.i - b.i;
            if (ak == null) return 1;   // no-signal items sink to the end
            if (bk == null) return -1;
            return (mode === 'newest' ? (bk - ak) : (ak - bk)) || (a.i - b.i);
        });
        return decorated.map(function (x) { return x.todo; });
    }

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

    // Backfill a stable createdAt on items that lack one, so newest/oldest work
    // for legacy todos whose ids predate the timestamped-id scheme. Uses the id
    // timestamp when parseable; otherwise a synthetic stamp placed below all
    // known ones, preserving stored order (front = newest, since adds unshift).
    function backfillCreatedAt(list) {
        var i, t, min = Infinity, missing = [];
        for (i = 0; i < list.length; i++) {
            if (typeof list[i].createdAt === 'number') { if (list[i].createdAt < min) min = list[i].createdAt; continue; }
            t = idTime(list[i].id);
            if (t != null) { list[i].createdAt = t; if (t < min) min = t; }
            else missing.push(i);
        }
        if (!isFinite(min)) min = 0;
        for (i = 0; i < missing.length; i++) list[missing[i]].createdAt = min - 1 - i;
        return list;
    }

    // Strictly-increasing creation stamp (handles multiple adds in one ms).
    var _lastStamp = 0;
    function nextStamp() {
        var now = Date.now();
        _lastStamp = now > _lastStamp ? now : _lastStamp + 1;
        return _lastStamp;
    }

    // ---- Node test hook -----------------------------------------------------
    // When loaded under Node (no DOM), export the pure helpers for the test
    // harness and stop before the browser bootstrap. In a browser `module` is
    // undefined, so this whole block is skipped and behavior is unchanged.
    // (The exported functions are hoisted declarations defined further below.)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            APP_VERSION: APP_VERSION,
            coerce: coerce,
            parseImport: parseImport,
            parseRecycle: parseRecycle,
            normKey: normKey,
            mergeImport: mergeImport,
            planSync: planSync,
            genId: genId,
            fuzzyMatch: fuzzyMatch,
            searchActions: searchActions,
            idTime: idTime,
            sortTodos: sortTodos,
            orderByRandom: orderByRandom,
            shuffleIds: shuffleIds
        };
        return;
    }

    window.alert = function (message, title) {
        return buildDialog(message, {
            title: title || L.dialogPromptTitle,
            buttons: [{ label: L.dialogOK, value: true, cls: 'confirm' }]
        });
    };
    window.confirm = function (message, title) {
        return buildDialog(message, {
            title: title || L.dialogConfirmTitle,
            buttons: [
                { label: L.dialogCancel, value: false, cls: 'cancel' },
                { label: L.dialogOK, value: true, cls: 'confirm' }
            ]
        });
    };

    // ---- Import parsing + dedupe merge (BUG-3 / IO-4 / IO-6) ----------------
    // Accepts: a JSON array of todos, a {todos:[...]} backup object, a JSON
    // array of strings, or newline-delimited plain text. Returns coerced todos
    // (title required) or null if the input can't be understood at all.
    function parseImport(content) {
        if (content == null) return null;
        var text = String(content).trim();
        if (!text) return [];

        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }

        var items;
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.todos)) {
            items = data.todos;
        } else if (data === null) {
            items = text.split(/\r?\n/); // plain text, one item per line
        } else {
            return null;
        }

        var out = [];
        items.forEach(function (it) {
            var c = coerce(it);
            if (c.title && c.title.trim()) out.push(c);
        });
        return out;
    }

    // Extract the recycle-bin array from a full backup object (IO-5), so
    // importing an export restores trashed items too. Plain todo lists and
    // newline text have no recycle bin -> returns [].
    function parseRecycle(content) {
        if (content == null) return [];
        var data;
        try { data = JSON.parse(String(content).trim()); } catch (e) { return []; }
        if (!data || !Array.isArray(data.recycleBin)) return [];
        var out = [];
        data.recycleBin.forEach(function (it) {
            var c = coerce(it);
            if (c.title && c.title.trim()) out.push(c);
        });
        return out;
    }

    function normKey(t) {
        return (t.title || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + (t.completed ? '1' : '0');
    }

    // Merge `incoming` into `targetList` (mutated in place), deduping by stable
    // id first, then by normalized title + completed state. Returns counts.
    function mergeImport(targetList, incoming) {
        var byId = {};
        var byKey = {};
        targetList.forEach(function (t) { byId[t.id] = t; byKey[normKey(t)] = t; });

        var updated = 0, skipped = 0;
        // Collect genuinely-new items in incoming order, then unshift them as one
        // batch after the loop. Unshifting one-by-one inside the loop would reverse
        // the imported list (last item ends up on top); batching keeps file order
        // while still landing new items at the front, like a single new todo does.
        var added = [];
        incoming.forEach(function (inc) {
            if (inc.id != null && byId[inc.id]) {
                var ex = byId[inc.id];
                if (ex.title !== inc.title || ex.completed !== inc.completed) {
                    delete byKey[normKey(ex)];
                    ex.title = inc.title;
                    ex.completed = inc.completed;
                    byKey[normKey(ex)] = ex;
                    updated++;
                } else {
                    skipped++;
                }
                return;
            }
            if (byKey[normKey(inc)]) { skipped++; return; }
            // Preserve a non-colliding incoming id so stable ids propagate across
            // devices (later re-imports then match by id, not just by title).
            var newId = (inc.id != null && !byId[inc.id]) ? inc.id : genId();
            var nt = { id: newId, title: inc.title, completed: inc.completed, removed: false };
            byId[nt.id] = nt;
            byKey[normKey(nt)] = nt;
            added.push(nt);
        });
        // Use the array's OWN unshift, not Array.prototype.unshift: when targetList
        // is a Vue-observed array (this.todos / this.recycleBin), Vue 2 replaces its
        // mutation methods with reactive interceptors. Calling Array.prototype.unshift
        // directly bypasses that interceptor, so the items land in the array but Vue
        // is never notified — computed counts (completed/ongoing) go stale and the
        // deep watcher never persists to localStorage (import looks fine, then a
        // refresh wipes it). Dispatching through targetList.unshift keeps it reactive.
        if (added.length) targetList.unshift.apply(targetList, added);
        return { added: added.length, updated: updated, skipped: skipped };
    }

    // ---- Cross-device sync reconcile (last-write-wins) ----------------------
    // Decide what this device should do when it sees the remote blob. Pure and
    // testable; the Vue layer carries out the chosen action.
    //   local  = { updatedAt:Number, hasData:Boolean, synced:Boolean }
    //   remote = parsed blob object, or null/garbage (treated as "no remote")
    //
    // Blob-level LAST-WRITE-WINS — the deliberately "rudimentary" model: the
    // newer whole snapshot wins, so deletions propagate too (a per-item merge
    // would resurrect items deleted on the other device). The ONE exception is
    // FIRST CONTACT on a device (synced=false) with a non-empty remote: we
    // union via the tested mergeImport path so a device's pre-sync todos are
    // never silently clobbered the first time it connects. After that, pure LWW.
    function planSync(local, remote) {
        local = local || {};
        var localAt = typeof local.updatedAt === 'number' ? local.updatedAt : 0;
        var remoteAt = (remote && typeof remote.updatedAt === 'number') ? remote.updatedAt : 0;
        var remoteHasData = !!(remote && (
            (Array.isArray(remote.todos) && remote.todos.length) ||
            (Array.isArray(remote.recycleBin) && remote.recycleBin.length)
        ));
        if (!remoteHasData) return { action: local.hasData ? 'push' : 'none' };
        if (!local.synced) return { action: 'merge' };
        if (remoteAt > localAt) return { action: 'pull' };
        if (localAt > remoteAt) return { action: 'push' };
        return { action: 'none' };
    }

    // ---- Vue instance -------------------------------------------------------
    var initial = loadState();
    var settings = loadSettings();
    var syncMeta = loadSyncMeta();
    var sortPref = loadSort();
    applyTheme(settings.theme); // apply before mount to avoid a flash

    var app = new Vue({
        el: '#todo-app',
        data: function () {
            return {
                todos: initial.todos,
                newTodoTitle: '',
                editedTodo: null,
                intention: localStorage.getItem(FILTER_KEY) || 'all', // restore last-used filter
                sortMode: sortPref.mode,        // custom|az|za|newest|oldest|random — a VIEW, not a mutation
                randomOrder: sortPref.randomOrder, // ids in shuffled order; the random lens reads this
                checkEmpty: false,
                recycleBin: initial.recycle,
                dragIndex: null,
                enterIndex: '',
                show: true,
                delayTime: '1',
                isShow: false,
                shortCut: 'OPEN✨',
                popShow: true,
                windowWidth: document.documentElement.clientWidth,
                slogan: localStorage.getItem(SLOGAN_KEY) || L.defaultSlogan,
                isEditing: false,
                originalSlogan: '',
                lang: ACTIVE_LANG,
                showBulk: false,
                bulkText: '',
                showPaste: false,
                pasteText: '',
                showSettings: false,
                theme: settings.theme,
                themeList: THEMES,
                touchDragging: false,
                touchTimer: null,
                touchStartX: 0,
                touchStartY: 0,
                showMore: false,
                showPalette: false,
                paletteQuery: '',
                paletteIndex: 0,
                showSort: false,
                confirmId: null,
                confirmCount: 0,
                // ---- Cross-device sync (optional same-origin backend) ----
                syncUpdatedAt: syncMeta.updatedAt, // logical version of local data
                syncSynced: syncMeta.synced,       // have we reconciled before?
                syncAvailable: null,               // null=unknown, true/false after probe
                syncStatus: 'idle',                // idle|syncing|synced|offline|error
                syncLastAt: 0,                     // wall-clock of last successful sync
                showSyncStatus: false              // reveal the status row once relevant
            };
        },
        watch: {
            todos: {
                handler: function (todos) { todoStorage.save(todos); this.touchData(); },
                deep: true
            },
            recycleBin: {
                handler: function (items) { recycleStorage.save(items); this.touchData(); },
                deep: true
            },
            intention: function (val) { safeSet(FILTER_KEY, val); this.clearConfirm(); },
            sortMode: function () { this.saveSort(); },
            randomOrder: function () { this.saveSort(); },
            paletteQuery: function () { this.paletteIndex = 0; },
            theme: function (val) {
                safeSet(SETTINGS_KEY, JSON.stringify({ theme: val }));
                applyTheme(val);
            }
        },
        computed: {
            t: function () { return I18N[this.lang] || I18N.en || {}; },
            // Short, localized label for the sync status row.
            syncStatusText: function () {
                var t = this.t;
                if (this.syncStatus === 'synced') {
                    if (this.syncLastAt) {
                        var time = new Date(this.syncLastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return this.tf('syncSyncedAt', { time: time });
                    }
                    return t.syncSynced;
                }
                var map = { idle: t.syncIdle, syncing: t.syncSyncing, offline: t.syncOffline, error: t.syncError };
                return map[this.syncStatus] || t.syncIdle;
            },
            emptyChecked: function () {
                return this.newTodoTitle.length === 0 && this.checkEmpty;
            },
            leftTodos: function () {
                return this.todos.filter(function (todo) { return !todo.completed; });
            },
            leftTodosCount: function () { return this.leftTodos.length; },
            completedTodos: function () {
                return this.todos.filter(function (todo) { return todo.completed; });
            },
            completedTodosCount: function () { return this.completedTodos.length; },
            filteredTodos: function () {
                if (this.intention === 'ongoing') return this.leftTodos;
                if (this.intention === 'completed') return this.completedTodos;
                if (this.intention === 'removed') return this.recycleBin;
                return this.todos;
            },
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
            showEmptyTips: function () {
                return this.filteredTodos.length === 0 && this.intention !== 'removed';
            },
            themeOptions: function () {
                var t = this.t;
                var labels = {
                    classic: t.themeClassic, dark: t.themeDark, sepia: t.themeSepia,
                    ocean: t.themeOcean, contrast: t.themeContrast, pastel: t.themePastel,
                    auto: t.themeAuto
                };
                return this.themeList.map(function (name) { return { value: name, label: labels[name] || name }; });
            },
            // Single source of truth for every command. Feeds both the More
            // menu and the command palette. `when` controls availability.
            actions: function () {
                var self = this, t = this.t;
                return [
                    { id: 'sort-manual',    label: t.sortManual,       icon: '↕',  section: 'sort', mode: 'custom', when: this.todos.length > 1,    run: function () { self.sortBy('custom'); } },
                    { id: 'sort-az',        label: t.sortAZ,           icon: '↓',  section: 'sort', mode: 'az',     when: this.todos.length > 1,    run: function () { self.sortBy('az'); } },
                    { id: 'sort-za',        label: t.sortZA,           icon: '↑',  section: 'sort', mode: 'za',     when: this.todos.length > 1,    run: function () { self.sortBy('za'); } },
                    { id: 'sort-newest',    label: t.sortNewest,       icon: '🕒', section: 'sort', mode: 'newest', when: this.todos.length > 1,    run: function () { self.sortBy('newest'); } },
                    { id: 'sort-oldest',    label: t.sortOldest,       icon: '🕘', section: 'sort', mode: 'oldest', when: this.todos.length > 1,    run: function () { self.sortBy('oldest'); } },
                    { id: 'sort-random',    label: t.sortRandom,       icon: '🔀', section: 'sort', mode: 'random', when: this.todos.length > 1,    run: function () { self.sortBy('random'); } },
                    { id: 'finishAll',      label: t.finishAll,        icon: '✓',  section: 'organize', when: this.leftTodosCount > 0,       run: function () { self.markAllAsCompleted(); } },
                    { id: 'clearCompleted', label: t.clearCompletedBtn, icon: '🧹', section: 'cleanup',  when: this.completedTodosCount > 0,  run: function () { self.clearCompleted(); } },
                    { id: 'clearAll',       label: t.clearAllBtn,      icon: '🗑', section: 'cleanup',  danger: true, when: this.todos.length > 0, run: function () { self.clearAll(); } },
                    { id: 'bulkAdd',        label: t.bulkAdd,          icon: '＋', section: 'data',     when: true,                          run: function () { self.openBulk(); } },
                    { id: 'exportFile',     label: t.exportFile,       icon: '⤓',  section: 'data',     when: true,                          run: function () { self.exportFile(); } },
                    { id: 'copy',           label: t.copyClipboard,    icon: '⧉',  section: 'data',     when: true,                          run: function () { self.copyToClipboard(); } },
                    { id: 'importFile',     label: t.importFile,       icon: '⤒',  section: 'data',     when: true,                          run: function () { self.importFile(); } },
                    { id: 'paste',          label: t.pasteClipboard,   icon: '⎘',  section: 'data',     when: true,                          run: function () { self.pasteFromClipboard(); } },
                    { id: 'sync',           label: t.syncNow,          icon: '⟲',  section: 'app',      when: true,                          run: function () { self.syncNow(); } },
                    { id: 'settings',       label: t.settings,         icon: '⚙',  section: 'app',      when: true,                          run: function () { self.openSettings(); } },
                    { id: 'reload',         label: t.reload,           icon: '⟳',  section: 'app',      when: true,                          run: function () { location.reload(); } }
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
                    ? [{ id: 'ctx-finishAll', label: t.finishAll, confirm: true, run: function () { self.doFinishAll(); } }]
                    : [];
            },
            // Available actions filtered by the palette query.
            paletteResults: function () {
                return searchActions(this.actions, this.paletteQuery);
            },
            // The available sort modes, for the dedicated Sort menu.
            sortActions: function () {
                return searchActions(this.actions, '').filter(function (a) { return a.section === 'sort'; });
            }
        },
        methods: {
            // String interpolation: tf('importSummary', {added:1,...})
            tf: function (key, vars) {
                var s = (this.t && this.t[key]) || '';
                if (vars) for (var k in vars) { s = s.split('{' + k + '}').join(vars[k]); }
                return s;
            },

            // Slogan editing
            editText: function () {
                this.originalSlogan = this.slogan;
                this.isEditing = true;
                var self = this;
                this.$nextTick(function () { if (self.$refs.sloganInput) self.$refs.sloganInput.focus(); });
            },
            saveText: function () {
                this.isEditing = false;
                safeSet(SLOGAN_KEY, this.slogan);
                this.touchData();
            },
            cancelText: function () {
                this.slogan = this.originalSlogan;
                this.isEditing = false;
            },

            // Layout helpers
            contorlScreen: function () {
                if (this.windowWidth < 768) {
                    this.isShow = !this.isShow;
                    this.shortCut = 'Filter';
                }
            },
            togglePop: function () { this.popShow = !this.popShow; },
            shortCutAction: function () {
                this.isShow = !this.isShow;
                this.shortCut = this.isShow ? '＝' : 'OPEN✨';
            },

            // Add / complete
            addTodo: function () {
                if (this.newTodoTitle === '') { this.checkEmpty = true; return; }
                this.todos.unshift({ id: genId(), title: this.newTodoTitle, completed: false, removed: false, createdAt: nextStamp() });
                this.newTodoTitle = '';
                this.checkEmpty = false;
                this.delayTime = '0';
            },
            markAsCompleted: function (todo) { todo.completed = true; },
            markAsUncompleted: function (todo) { todo.completed = false; },
            // Bare action — no prompt. The context bar guards it with an inline
            // two-step confirm; the More menu / palette guard it with a modal.
            doFinishAll: function () {
                this.todos.forEach(function (todo) { if (!todo.completed) todo.completed = true; });
            },
            markAllAsCompleted: function () {
                var self = this;
                confirm(this.t.confirmMarkAll).then(function (ok) { if (ok) self.doFinishAll(); });
            },

            // Remove / restore
            removeTodo: function (todo) {
                var idx = this.todos.indexOf(todo);
                if (idx === -1) return; // not in the active list (e.g. an edited trashed item)
                var removedTodo = this.todos.splice(idx, 1)[0];
                removedTodo.removed = true;
                this.recycleBin.unshift(removedTodo);
            },
            restoreTodo: function (todo) {
                var pos = this.recycleBin.indexOf(todo);
                if (pos === -1) return; // guard against splice(-1) deleting the wrong item
                todo.removed = false;
                this.todos.unshift(todo);
                this.recycleBin.splice(pos, 1);
            },

            // Inline edit
            editdTodo: function (todo) { this.editedTodo = { id: todo.id, title: todo.title }; },
            editDone: function (todo) {
                if (todo.title === '') this.removeTodo(todo);
                this.editedTodo = null;
            },
            cancelEdit: function (todo) {
                todo.title = this.editedTodo.title;
                this.editedTodo = null;
            },

            // Bulk operations
            clearCompleted: function () {
                var self = this;
                confirm(this.t.confirmClearCompleted).then(function (ok) {
                    if (ok) {
                        var done = self.completedTodos;
                        done.forEach(function (todo) { todo.removed = true; });
                        self.recycleBin.unshift.apply(self.recycleBin, done);
                        self.todos = self.leftTodos;
                    }
                });
            },
            clearAll: function () {
                var self = this;
                confirm(this.t.confirmClearAll).then(function (ok) {
                    if (ok) {
                        self.todos.forEach(function (todo) { todo.removed = true; });
                        self.recycleBin.unshift.apply(self.recycleBin, self.todos);
                        self.todos = [];
                    }
                });
            },

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

            // ---- Cross-device sync (optional same-origin PHP backend) ------
            // The whole flow degrades gracefully: if sync.php is missing or
            // unreachable (static host, file://, no PHP), the app keeps working
            // on localStorage alone and never shows a blocking error.

            // Called by the data watchers / slogan save on any LOCAL change.
            // Bumps the local sync clock and schedules a debounced push. Skipped
            // while we're applying a remote snapshot (that isn't a local edit).
            touchData: function () {
                if (this._applyingRemote) return;
                this.syncUpdatedAt = nextStamp();
                saveSyncMeta({ updatedAt: this.syncUpdatedAt, synced: this.syncSynced });
                this.scheduleSyncPush();
            },
            scheduleSyncPush: function () {
                if (this.syncAvailable !== true) return; // unknown/offline -> stay local-only
                var self = this;
                clearTimeout(this._syncPushTimer);
                this._syncPushTimer = setTimeout(function () { self.pushSync(); }, 1500);
            },

            buildSyncPayload: function () {
                return {
                    version: 1,
                    updatedAt: this.syncUpdatedAt,
                    slogan: this.slogan,
                    todos: this.todos,
                    recycleBin: this.recycleBin
                };
            },

            // Low-level fetches. Same-origin + credentials so the browser
            // auto-sends the Basic Auth header that gates the whole site.
            syncGet: function () {
                return fetch(SYNC_ENDPOINT, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    cache: 'no-store',
                    credentials: 'same-origin'
                }).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            },
            syncPut: function (payload) {
                return fetch(SYNC_ENDPOINT, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    cache: 'no-store',
                    credentials: 'same-origin'
                }).then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                });
            },

            // Best-effort upload of the current local state.
            pushSync: function () {
                if (this.syncAvailable !== true) return Promise.resolve();
                var self = this;
                this.syncStatus = 'syncing';
                return this.syncPut(this.buildSyncPayload()).then(function () {
                    self.syncSynced = true;
                    self.syncLastAt = Date.now();
                    self.syncStatus = 'synced';
                    saveSyncMeta({ updatedAt: self.syncUpdatedAt, synced: true });
                }).catch(function () {
                    // Endpoint went away mid-session: stop auto-pushing until the
                    // user explicitly retries via "Sync now".
                    self.syncAvailable = false;
                    self.syncStatus = 'error';
                });
            },

            // Adopt the remote snapshot wholesale (blob last-write-wins on pull).
            applyRemote: function (remote) {
                var self = this;
                this._applyingRemote = true; // suppress touchData for these writes
                var todos = sanitizeRemoteList(remote.todos);
                var recycle = sanitizeRemoteList(remote.recycleBin);
                recycle.forEach(function (t) { t.removed = true; });
                if (typeof remote.slogan === 'string' && remote.slogan) {
                    this.slogan = remote.slogan;
                    safeSet(SLOGAN_KEY, remote.slogan);
                }
                this.todos = todos;
                this.recycleBin = recycle;
                this.syncUpdatedAt = (typeof remote.updatedAt === 'number') ? remote.updatedAt : nextStamp();
                this.syncSynced = true;
                saveSyncMeta({ updatedAt: this.syncUpdatedAt, synced: true });
                this.$nextTick(function () { self._applyingRemote = false; });
            },

            // First contact on this device: union local + remote (no data loss),
            // then push the union up so other devices converge on it.
            mergeRemote: function (remote) {
                var self = this;
                this._applyingRemote = true; // we drive the push explicitly below
                var todos = sanitizeRemoteList(remote.todos);
                var recycle = sanitizeRemoteList(remote.recycleBin);
                mergeImport(this.todos, todos);
                if (recycle.length) {
                    mergeImport(this.recycleBin, recycle);
                    this.recycleBin.forEach(function (t) { t.removed = true; });
                }
                this.syncUpdatedAt = nextStamp(); // union is a new version, newer than remote
                this.syncSynced = true;
                saveSyncMeta({ updatedAt: this.syncUpdatedAt, synced: true });
                this.$nextTick(function () { self._applyingRemote = false; });
                return this.pushSync();
            },

            // Fetch the remote blob and act on the planSync decision.
            runSync: function (opts) {
                var self = this;
                var silent = opts && opts.silent;
                // No fetch (very old browser / odd host) -> behave like "offline".
                if (typeof fetch !== 'function') {
                    this.syncAvailable = false;
                    if (!silent) { this.showSyncStatus = true; this.syncStatus = 'offline'; }
                    return Promise.resolve();
                }
                if (!silent) { this.showSyncStatus = true; this.syncStatus = 'syncing'; }
                return this.syncGet().then(function (remote) {
                    self.syncAvailable = true;
                    self.showSyncStatus = true;
                    var plan = planSync({
                        updatedAt: self.syncUpdatedAt,
                        hasData: !!(self.todos.length || self.recycleBin.length),
                        synced: self.syncSynced
                    }, remote);
                    if (plan.action === 'pull') {
                        self.applyRemote(remote);
                        self.syncLastAt = Date.now();
                        self.syncStatus = 'synced';
                    } else if (plan.action === 'merge') {
                        return self.mergeRemote(remote).then(function () { self.syncLastAt = Date.now(); });
                    } else if (plan.action === 'push') {
                        // Seeding an empty remote: stamp a real version first so
                        // cross-device ordering starts from a meaningful timestamp.
                        if (!self.syncUpdatedAt) {
                            self.syncUpdatedAt = nextStamp();
                            saveSyncMeta({ updatedAt: self.syncUpdatedAt, synced: self.syncSynced });
                        }
                        return self.pushSync();
                    } else { // none — already in sync
                        self.syncSynced = true;
                        saveSyncMeta({ updatedAt: self.syncUpdatedAt, synced: true });
                        self.syncLastAt = Date.now();
                        self.syncStatus = 'synced';
                    }
                }).catch(function () {
                    self.syncAvailable = false;
                    if (!silent) { self.showSyncStatus = true; self.syncStatus = 'offline'; }
                });
            },

            // User-triggered (status row, More menu, ⌘K palette).
            syncNow: function () { this.runSync({ silent: false }); },

            // Silent probe on load: detect the backend, then reconcile. No UI
            // noise if it isn't there.
            initSync: function () { this.runSync({ silent: true }); },

            // ---- Export ----
            buildPayload: function () {
                return {
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    slogan: this.slogan,
                    todos: this.todos,
                    recycleBin: this.recycleBin
                };
            },
            exportFile: function () {
                if (!this.todos.length && !this.recycleBin.length) { alert(this.t.nothingToExport); return; }
                var text = JSON.stringify(this.buildPayload(), null, 2);
                var date = new Date().toISOString().replace(/-|:|\.\d+/g, '');
                var fileName = 'todos-' + date.slice(0, 8) + '-' + date.slice(9, 15) + '.json';
                var el = document.createElement('a');
                el.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
                el.download = fileName;
                document.body.appendChild(el);
                el.click();
                document.body.removeChild(el);
            },
            copyToClipboard: function () {
                if (!this.todos.length && !this.recycleBin.length) { alert(this.t.nothingToExport); return; }
                var self = this;
                var text = JSON.stringify(this.buildPayload(), null, 2);
                var n = this.todos.length;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        alert(self.tf('clipboardCopied', { n: n }));
                    }).catch(function () { alert(self.t.clipboardCopyError, self.t.errorTitle); });
                } else {
                    alert(this.t.clipboardCopyError, this.t.errorTitle);
                }
            },

            // ---- Import ----
            applyImport: function (content) {
                var parsed = parseImport(content);
                if (parsed === null) { alert(this.t.importParseError, this.t.errorTitle); return false; }
                var recycled = parseRecycle(content); // restore trashed items from a full backup
                if (!parsed.length && !recycled.length) { alert(this.t.importEmpty); return false; }
                var res = mergeImport(this.todos, parsed);
                if (recycled.length) {
                    mergeImport(this.recycleBin, recycled);
                    this.recycleBin.forEach(function (t) { t.removed = true; });
                }
                alert(this.tf('importSummary', res));
                return true;
            },
            importFile: function () {
                var self = this;
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = '.txt,.json,application/json,text/plain';
                input.style.display = 'none';
                input.addEventListener('change', function (event) {
                    // Remove only after the picker has resolved — removing it
                    // synchronously after click() cancels the picker on iOS Safari.
                    if (input.parentNode) input.parentNode.removeChild(input);
                    var file = event.target.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function (e) { self.applyImport(e.target.result); };
                    reader.onerror = function (e) {
                        alert(self.tf('readFileError', { name: (e.target.error && e.target.error.name) || '' }), self.t.errorTitle);
                    };
                    reader.readAsText(file);
                });
                document.body.appendChild(input);
                input.click();
            },
            pasteFromClipboard: function () {
                var self = this;
                if (navigator.clipboard && navigator.clipboard.readText) {
                    navigator.clipboard.readText().then(function (text) {
                        self.applyImport(text);
                    }).catch(function () { self.openPaste(); });
                } else {
                    this.openPaste();
                }
            },

            // ---- Paste-import fallback modal ----
            openPaste: function () { this.pasteText = ''; this.showPaste = true; },
            cancelPaste: function () { this.showPaste = false; },
            confirmPaste: function () {
                var ok = this.applyImport(this.pasteText);
                if (ok) this.showPaste = false;
            },

            // ---- Bulk-add modal (IO-3) ----
            openBulk: function () { this.bulkText = ''; this.showBulk = true; },
            cancelBulk: function () { this.showBulk = false; },
            confirmBulk: function () {
                var parsed = parseImport(this.bulkText); // lines or JSON both accepted
                if (!parsed || !parsed.length) { this.showBulk = false; return; }
                var res = mergeImport(this.todos, parsed);
                this.showBulk = false;
                alert(this.tf('bulkSummary', res));
            },

            // Shared reorder used by both desktop drag-and-drop and touch drag.
            // Reordering only makes sense on the unfiltered "all" view.
            moveItem: function (from, to) {
                if (this.intention !== 'all') return;
                if (from == null || to == null || from === to) return;
                var src = this.todos[from];
                if (!src) return;
                this.todos.splice(from, 1);
                this.todos.splice(to, 0, src);
            },

            // Bake the current VISIBLE order into the manual order and switch to
            // it. Called at drag start so the rendered indices line up 1:1 with
            // this.todos before the live reorder begins. The order is unchanged
            // at this instant (displayTodos === the rendered list), so nothing
            // jumps. 'all'-view only (drag is too).
            bakeManualOrder: function () {
                if (this.intention !== 'all') return;
                if (this.sortMode !== 'custom') {
                    this.todos = this.displayTodos.slice();
                    this.sortMode = 'custom';
                }
            },

            // Desktop HTML5 drag-and-drop. Live-reorders as the cursor passes
            // over other items — the long-standing approach that works reliably
            // on desktop.
            //
            // setData()/effectAllowed in dragstart are REQUIRED by Safari and
            // Firefox to actually begin an element drag; without them those
            // browsers cancel it immediately (the cursor shows a drag but the
            // item never moves). Chrome works without them. dragstart also bakes
            // a sorted view down to the manual order first, so the visible
            // indices map 1:1 onto this.todos for the moveItem() splices.
            dragstart: function (e, index) {
                if (this.intention !== 'all') return;
                this.bakeManualOrder();
                this.dragIndex = index;
                if (e && e.dataTransfer) {
                    try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) {}
                    e.dataTransfer.effectAllowed = 'move';
                }
            },
            dragenter: function (e, index) {
                e.preventDefault();
                if (this.dragIndex !== null && this.dragIndex !== index) {
                    this.moveItem(this.dragIndex, index);
                    this.dragIndex = index;
                }
            },
            dragover: function (e) {
                e.preventDefault();                                  // valid drop target
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            },
            dragend: function () { this.dragIndex = null; },

            // Touch drag (mobile): long-press to pick up, then drag to reorder.
            // Long-press avoids fighting with normal list scrolling — a quick
            // swipe scrolls; holding still for ~280ms starts a drag.
            touchStartItem: function (index, e) {
                if (this.intention !== 'all') return;
                var touch = e.touches && e.touches[0];
                if (!touch) return;
                this.dragIndex = index;
                this.touchStartX = touch.clientX;
                this.touchStartY = touch.clientY;
                var self = this;
                clearTimeout(this.touchTimer);
                this.touchTimer = setTimeout(function () {
                    self.bakeManualOrder(); // order unchanged; dragIndex still valid
                    self.touchDragging = true;
                }, 280);
            },
            touchMoveItem: function (e) {
                var touch = e.touches && e.touches[0];
                if (!touch) return;
                if (!this.touchDragging) {
                    // Still deciding: a real move before long-press fires means
                    // the user is scrolling, so cancel the pending pick-up.
                    var dx = Math.abs(touch.clientX - this.touchStartX);
                    var dy = Math.abs(touch.clientY - this.touchStartY);
                    if (dx > 10 || dy > 10) { clearTimeout(this.touchTimer); this.touchTimer = null; }
                    return; // allow native scrolling
                }
                e.preventDefault(); // we own the gesture now
                var el = document.elementFromPoint(touch.clientX, touch.clientY);
                while (el && !(el.classList && el.classList.contains('todo-item'))) el = el.parentElement;
                if (!el) return;
                var idx = parseInt(el.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx !== this.dragIndex) {
                    this.moveItem(this.dragIndex, idx);
                    this.dragIndex = idx;
                }
            },
            touchEndItem: function () {
                clearTimeout(this.touchTimer);
                this.touchTimer = null;
                this.touchDragging = false;
                this.dragIndex = null;
            },

            // transition-group JS animation hooks
            beforeEnter: function (dom) { dom.classList.add('drag-enter-active'); },
            enter: function (dom, done) {
                var self = this;
                var delay = parseInt(dom.dataset.delay, 10) || 0;
                setTimeout(function () {
                    self.delayTime = '1';
                    dom.classList.remove('drag-enter-active');
                    dom.classList.add('drag-enter-to');
                    var transitionend = window.ontransitionend ? 'transitionend' : 'webkitTransitionEnd';
                    var finished = false;
                    function finish() {
                        if (finished) return;
                        finished = true;
                        dom.removeEventListener(transitionend, finish);
                        done();
                    }
                    dom.addEventListener(transitionend, finish);
                    // Fallback: if no transition runs (reduced motion, 0 delay), don't hang the item.
                    setTimeout(finish, 600);
                }, delay);
            },
            afterEnter: function (dom) { dom.classList.remove('drag-enter-to'); },

            saveLanguage: function (lang) { safeSet('uiineed-todos-lang', lang); },

            // Settings panel
            openSettings: function () { this.showSettings = true; },
            closeSettings: function () { this.showSettings = false; },
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
            openSort: function () { this.showSort = true; },
            closeSort: function () { this.showSort = false; },
            runAction: function (a) {
                this.closeMore();
                this.closePalette();
                this.closeSort();
                if (a && typeof a.run === 'function') a.run();
            },

            // ---- Inline two-step confirm for prevalent destructive context actions ----
            // Click once -> button counts down (disabled) -> 'Tap to confirm' -> runs.
            contextLabel: function (a) {
                if (this.confirmId !== a.id) return a.label;
                return this.confirmCount > 0
                    ? this.confirmCount + ''
                    : this.t.confirmReady;
            },
            armConfirm: function (a) {
                var self = this;
                this.clearConfirm();
                this.confirmId = a.id;
                this.confirmCount = 3;
                this._confirmTimer = setInterval(function () {
                    self.confirmCount -= 1;
                    if (self.confirmCount <= 0) {
                        clearInterval(self._confirmTimer);
                        self._confirmTimer = null;
                        // Stay armed for a short grace window, then auto-cancel.
                        self._confirmReset = setTimeout(function () { self.clearConfirm(); }, 6000);
                    }
                }, 1000);
            },
            clearConfirm: function () {
                if (this._confirmTimer) { clearInterval(this._confirmTimer); this._confirmTimer = null; }
                if (this._confirmReset) { clearTimeout(this._confirmReset); this._confirmReset = null; }
                this.confirmId = null;
                this.confirmCount = 0;
            },
            onContextClick: function (a) {
                if (!a.confirm) { a.run(); return; }
                if (this.confirmId === a.id) {
                    if (this.confirmCount <= 0) {        // armed & ready -> go
                        var run = a.run;
                        this.clearConfirm();
                        if (typeof run === 'function') run();
                    }
                    return;                              // still counting down -> ignore
                }
                this.armConfirm(a);
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
                    if (this.showSort) { this.closeSort(); return; }
                    if (this.confirmId) { this.clearConfirm(); return; }
                }
                if (!this.showPalette) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); this.paletteMove(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); this.paletteMove(-1); }
                else if (e.key === 'Enter') { e.preventDefault(); this.paletteEnter(); }
            }
        },
        directives: {
            focus: {
                inserted: function (el) { el.focus(); }
            }
        },
        mounted: function () {
            this.show = true;
            this._applyingRemote = false;
            var self = this;
            // If the restored filter has nothing to show, fall back to "all"
            var counts = {
                ongoing: this.leftTodosCount,
                completed: this.completedTodosCount,
                removed: this.recycleBin.length
            };
            if (this.intention !== 'all' && !counts[this.intention]) this.intention = 'all';
            this.contorlScreen();
            window.onresize = function () {
                window.fullWidth = document.documentElement.clientWidth;
                self.windowWidth = window.fullWidth;
            };
            document.addEventListener('keydown', this.onKeydown);
            this.initSync(); // probe the optional sync backend and reconcile
        },
        beforeDestroy: function () {
            document.removeEventListener('keydown', this.onKeydown);
            this.clearConfirm();
            clearTimeout(this._syncPushTimer);
        }
    });

    window.app = app;
    window.UIINEED_VERSION = APP_VERSION;

    // Keep the 'auto' theme in sync with live OS light/dark changes (no reload needed).
    var _mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (_mq) {
        var _onScheme = function () { if (app.theme === 'auto') applyTheme('auto'); };
        if (_mq.addEventListener) _mq.addEventListener('change', _onScheme);
        else if (_mq.addListener) _mq.addListener(_onScheme); // Safari < 14
    }
})();
