/*
 * app.js — shared logic for the Uiineed Todo List (English + Chinese pages).
 *
 * Both index.html and index-zh.html load this same file. The page sets
 * `window.UIINEED_LANG` ('en' | 'zh') before loading; everything else (storage,
 * dialogs, import/export, the Vue instance) lives here so behavior is defined once.
 *
 * Templates stay in each HTML file (their author/About sections differ on purpose),
 * but all user-facing text is pulled from i18n.js via the `t` / `tf` helpers.
 */
(function () {
    'use strict';

    var ACTIVE_LANG = (window.UIINEED_LANG === 'zh') ? 'zh' : 'en';
    var I18N = window.I18N || {};
    var L = I18N[ACTIVE_LANG] || I18N.en || {};

    // ---- Storage keys -------------------------------------------------------
    var STORAGE_KEY = 'uiineed-todos';
    var RECYCLE_KEY = 'uiineed-recycle';
    var FILTER_KEY = 'uiineed-filter';
    var SLOGAN_KEY = 'uiineed-slogan';
    var SETTINGS_KEY = 'uiineed-settings';

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
        return { todos: todos, recycle: recycle };
    }

    var todoStorage = {
        save: function (todos) { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); }
    };
    var recycleStorage = {
        save: function (items) { localStorage.setItem(RECYCLE_KEY, JSON.stringify(items)); }
    };

    // ---- Custom dialogs (SEC-1: text set via textContent, never innerHTML) --
    function buildDialog(message, opts) {
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';
            var box = document.createElement('div');
            box.className = 'custom-alert';

            var titleEl = document.createElement('div');
            titleEl.className = 'custom-alert-title';
            titleEl.textContent = opts.title;
            box.appendChild(titleEl);

            var contentEl = document.createElement('div');
            contentEl.className = 'custom-alert-content';
            contentEl.textContent = message;
            box.appendChild(contentEl);

            var btnWrap = document.createElement('div');
            btnWrap.className = 'custom-alert-buttons';
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

    function normKey(t) {
        return (t.title || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + (t.completed ? '1' : '0');
    }

    // Merge `incoming` into `targetList` (mutated in place), deduping by stable
    // id first, then by normalized title + completed state. Returns counts.
    function mergeImport(targetList, incoming) {
        var byId = {};
        var byKey = {};
        targetList.forEach(function (t) { byId[t.id] = t; byKey[normKey(t)] = t; });

        var added = 0, updated = 0, skipped = 0;
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
            var nt = { id: genId(), title: inc.title, completed: inc.completed, removed: false };
            targetList.unshift(nt);
            byId[nt.id] = nt;
            byKey[normKey(nt)] = nt;
            added++;
        });
        return { added: added, updated: updated, skipped: skipped };
    }

    // ---- Vue instance -------------------------------------------------------
    var initial = loadState();
    var settings = loadSettings();
    applyTheme(settings.theme); // apply before mount to avoid a flash

    var app = new Vue({
        el: '#todo-app',
        data: function () {
            return {
                todos: initial.todos,
                newTodoTitle: '',
                editedTodo: null,
                intention: localStorage.getItem(FILTER_KEY) || 'all', // restore last-used filter
                checkEmpty: false,
                recycleBin: initial.recycle,
                dragIndex: '',
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
                themeList: THEMES
            };
        },
        watch: {
            todos: {
                handler: function (todos) { todoStorage.save(todos); },
                deep: true
            },
            recycleBin: {
                handler: function (items) { recycleStorage.save(items); },
                deep: true
            },
            intention: function (val) { localStorage.setItem(FILTER_KEY, val); },
            theme: function (val) {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: val }));
                applyTheme(val);
            }
        },
        computed: {
            t: function () { return I18N[this.lang] || I18N.en || {}; },
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
                localStorage.setItem(SLOGAN_KEY, this.slogan);
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
                this.todos.unshift({ id: genId(), title: this.newTodoTitle, completed: false, removed: false });
                this.newTodoTitle = '';
                this.checkEmpty = false;
                this.delayTime = '0';
            },
            markAsCompleted: function (todo) { todo.completed = true; },
            markAsUncompleted: function (todo) { todo.completed = false; },
            markAllAsCompleted: function () {
                var self = this;
                confirm(this.t.confirmMarkAll).then(function (ok) {
                    if (ok) self.todos.forEach(function (todo) { if (!todo.completed) todo.completed = true; });
                });
            },

            // Remove / restore
            removeTodo: function (todo) {
                var removedTodo = this.todos.splice(this.todos.indexOf(todo), 1)[0];
                removedTodo.removed = true;
                this.recycleBin.unshift(removedTodo);
            },
            restoreTodo: function (todo) {
                todo.removed = false;
                this.todos.unshift(todo);
                var pos = this.recycleBin.indexOf(todo);
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

            // Auto-sort (QOL-2): one-shot alphabetical sort of the active list
            sortAZ: function () {
                this.todos.sort(function (a, b) {
                    return (a.title || '').localeCompare(b.title || '');
                });
            },

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
                if (!parsed.length) { alert(this.t.importEmpty); return false; }
                var res = mergeImport(this.todos, parsed);
                alert(this.tf('importSummary', res));
                return true;
            },
            importFile: function () {
                var self = this;
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = '.txt,.json';
                input.style.display = 'none';
                input.addEventListener('change', function (event) {
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
                document.body.removeChild(input);
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

            // Drag reorder (desktop pointer/HTML5 DnD; touch handled in a later pass)
            dragstart: function (index) { this.dragIndex = index; },
            dragenter: function (e, index) {
                e.preventDefault();
                if (this.dragIndex !== index && this.intention === 'all') {
                    var source = this.todos[this.dragIndex];
                    this.todos.splice(this.dragIndex, 1);
                    this.todos.splice(index, 0, source);
                    this.dragIndex = index;
                }
            },
            dragover: function (e) { e.preventDefault(); },

            // transition-group JS animation hooks
            beforeEnter: function (dom) { dom.classList.add('drag-enter-active'); },
            enter: function (dom, done) {
                var self = this;
                var delay = dom.dataset.delay;
                setTimeout(function () {
                    self.delayTime = '1';
                    dom.classList.remove('drag-enter-active');
                    dom.classList.add('drag-enter-to');
                    var transitionend = window.ontransitionend ? 'transitionend' : 'webkitTransitionEnd';
                    dom.addEventListener(transitionend, function onEnd() {
                        dom.removeEventListener(transitionend, onEnd);
                        done();
                    });
                }, delay);
            },
            afterEnter: function (dom) { dom.classList.remove('drag-enter-to'); },

            saveLanguage: function (lang) { localStorage.setItem('uiineed-todos-lang', lang); },

            // Settings panel
            openSettings: function () { this.showSettings = true; },
            closeSettings: function () { this.showSettings = false; },
            setTheme: function (name) { this.theme = name; }
        },
        directives: {
            focus: {
                inserted: function (el) { el.focus(); }
            }
        },
        mounted: function () {
            this.show = true;
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
        }
    });

    window.app = app;
})();
