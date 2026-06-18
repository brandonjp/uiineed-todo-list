/*
 * logic.test.js — zero-dependency unit tests for the pure data helpers in
 * public/js/app.js (parse / merge / dedupe / normalize). Run with:
 *
 *     node test/logic.test.js
 *
 * No npm install, no jsdom, no browser. app.js exports these helpers only when
 * loaded under Node (its "Node test hook"); in a browser that hook is skipped,
 * so this file tests the exact production code path used by the app.
 *
 * Covers the cross-device sync contract that the ROADMAP promises:
 *   export on device A -> import on device B -> re-import must NOT duplicate,
 *   stable ids propagate, edited titles update in place, full backups restore
 *   the recycle bin.
 */
'use strict';

var assert = require('assert');
var path = require('path');
var core = require(path.join(__dirname, '..', 'public', 'js', 'app.js'));

var passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('  ok - ' + name);
}

console.log('app.js pure-logic tests');

// ---- coerce -------------------------------------------------------------
test('coerce: string -> todo with null id', function () {
    assert.deepStrictEqual(core.coerce('Buy milk'),
        { id: null, title: 'Buy milk', completed: false, removed: false });
});
test('coerce: object passthrough with !!flags', function () {
    assert.deepStrictEqual(core.coerce({ id: 'x', title: 'A', completed: 1, removed: 0 }),
        { id: 'x', title: 'A', completed: true, removed: false });
});
test('coerce: null -> empty todo', function () {
    assert.strictEqual(core.coerce(null).title, '');
});

// ---- parseImport --------------------------------------------------------
test('parseImport: JSON array of objects', function () {
    var out = core.parseImport('[{"title":"A"},{"title":"B"}]');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].title, 'A');
});
test('parseImport: {todos:[...]} backup object', function () {
    var out = core.parseImport('{"todos":[{"title":"A"}],"recycleBin":[{"title":"Z"}]}');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].title, 'A'); // only the active list, not recycleBin
});
test('parseImport: JSON array of strings', function () {
    var out = core.parseImport('["A","B","C"]');
    assert.strictEqual(out.length, 3);
});
test('parseImport: newline plain text, blanks skipped', function () {
    var out = core.parseImport('A\n\n  \nB\n');
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out.map(function (t) { return t.title; }), ['A', 'B']);
});
test('parseImport: empty string -> []', function () {
    assert.deepStrictEqual(core.parseImport(''), []);
});
test('parseImport: bare JSON number -> null (unparseable as todos)', function () {
    assert.strictEqual(core.parseImport('123'), null);
});

// ---- parseRecycle -------------------------------------------------------
test('parseRecycle: extracts recycleBin from full backup', function () {
    var out = core.parseRecycle('{"todos":[{"title":"A"}],"recycleBin":[{"title":"Z"},{"title":"Y"}]}');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].title, 'Z');
});
test('parseRecycle: plain list has no recycle bin -> []', function () {
    assert.deepStrictEqual(core.parseRecycle('["A","B"]'), []);
});

// ---- mergeImport: the sync contract ------------------------------------
test('mergeImport: preserves a non-colliding incoming id (FIX F4)', function () {
    var target = [];
    var res = core.mergeImport(target, [{ id: 'a1', title: 'X', completed: false }]);
    assert.strictEqual(res.added, 1);
    assert.strictEqual(target.length, 1);
    assert.strictEqual(target[0].id, 'a1'); // not regenerated -> stable across devices
});
test('mergeImport: re-importing the SAME export creates no duplicates', function () {
    var exportFile = [{ id: 'a1', title: 'X', completed: false }];
    var target = [];
    core.mergeImport(target, exportFile);
    var res = core.mergeImport(target, exportFile); // second import of same data
    assert.strictEqual(res.added, 0);
    assert.strictEqual(res.skipped, 1);
    assert.strictEqual(target.length, 1);
});
test('mergeImport: an edited title on the same id UPDATES in place (no dup)', function () {
    var target = [];
    core.mergeImport(target, [{ id: 'a1', title: 'X', completed: false }]);
    var res = core.mergeImport(target, [{ id: 'a1', title: 'X edited', completed: true }]);
    assert.strictEqual(res.updated, 1);
    assert.strictEqual(res.added, 0);
    assert.strictEqual(target.length, 1);
    assert.strictEqual(target[0].title, 'X edited');
    assert.strictEqual(target[0].completed, true);
});
test('mergeImport: id-less items dedupe by normalized title + completed', function () {
    var target = [];
    core.mergeImport(target, [{ title: 'Buy Milk' }]);
    var res = core.mergeImport(target, [{ title: '  buy   milk ' }]); // same after normKey
    assert.strictEqual(res.added, 0);
    assert.strictEqual(res.skipped, 1);
    assert.strictEqual(target.length, 1);
});
test('mergeImport: genuinely new id-less item is added', function () {
    var target = [];
    core.mergeImport(target, [{ title: 'A' }]);
    var res = core.mergeImport(target, [{ title: 'B' }]);
    assert.strictEqual(res.added, 1);
    assert.strictEqual(target.length, 2);
});
test('mergeImport: new items keep their file order at the front (no reversal)', function () {
    var target = [];
    core.mergeImport(target, [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }]);
    assert.deepStrictEqual(target.map(function (t) { return t.title; }),
        ['First', 'Second', 'Third']);
});
test('mergeImport: new items land in front of existing ones, in file order', function () {
    var target = [];
    core.mergeImport(target, [{ title: 'Existing' }]);
    core.mergeImport(target, [{ title: 'New A' }, { title: 'New B' }]);
    assert.deepStrictEqual(target.map(function (t) { return t.title; }),
        ['New A', 'New B', 'Existing']);
});
test('mergeImport: dispatches through the array\'s OWN unshift (Vue reactivity)', function () {
    // Regression for the import/sync data-loss bug: Vue 2 makes an observed
    // array reactive by replacing its mutation methods (unshift/push/splice/...)
    // with interceptors that notify watchers. Calling Array.prototype.unshift
    // directly BYPASSES that interceptor — imported items land in the array but
    // Vue never fires, so the filter counts go stale and the deep watcher never
    // persists to localStorage (the import vanishes on the next refresh). This
    // spy mimics Vue's interceptor and asserts mergeImport routes through it.
    var target = [];
    var intercepted = 0;
    var nativeUnshift = Array.prototype.unshift;
    target.unshift = function () { intercepted++; return nativeUnshift.apply(this, arguments); };
    core.mergeImport(target, [{ title: 'A' }, { title: 'B' }]);
    assert.ok(intercepted > 0,
        'mergeImport must call the array\'s own unshift, not Array.prototype.unshift');
    assert.deepStrictEqual(target.map(function (t) { return t.title; }), ['A', 'B']);
});
test('mergeImport: two-device round trip converges (A->B->A, no growth)', function () {
    // Device A starts with two items.
    var A = [];
    core.mergeImport(A, [{ id: 'a1', title: 'One', completed: false },
                         { id: 'a2', title: 'Two', completed: false }]);
    // Export A, import into empty B.
    var B = [];
    core.mergeImport(B, A.map(function (t) { return { id: t.id, title: t.title, completed: t.completed }; }));
    assert.strictEqual(B.length, 2);
    // Edit on B, then export B and import back into A.
    B[0].title = 'One edited';
    core.mergeImport(A, B.map(function (t) { return { id: t.id, title: t.title, completed: t.completed }; }));
    assert.strictEqual(A.length, 2, 'A should not grow — ids match across devices');
    var titles = A.map(function (t) { return t.title; }).sort();
    assert.deepStrictEqual(titles, ['One edited', 'Two']);
});

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

// ---- idTime / compareBy (sort) -----------------------------------------
function mkId(t) { return 't' + t.toString(36) + '-0'; }
test('idTime: parses the timestamp baked into a genId-format id', function () {
    assert.strictEqual(core.idTime(mkId(100)), 100);
    assert.strictEqual(core.idTime(mkId(1700000000000)), 1700000000000);
});
test('idTime: non-matching id -> null', function () {
    assert.strictEqual(core.idTime('42'), null);
    assert.strictEqual(core.idTime(null), null);
    assert.strictEqual(core.idTime(undefined), null);
});
function titles(arr) { return arr.map(function (x) { return x.title; }); }
test('sortTodos: az / za by title', function () {
    var arr = [{ title: 'banana' }, { title: 'apple' }, { title: 'cherry' }];
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'az')), ['apple', 'banana', 'cherry']);
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'za')), ['cherry', 'banana', 'apple']);
});
test('sortTodos: newest / oldest prefer createdAt', function () {
    var arr = [{ title: 'mid', createdAt: 200 }, { title: 'new', createdAt: 300 }, { title: 'old', createdAt: 100 }];
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'oldest')), ['old', 'mid', 'new']);
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'newest')), ['new', 'mid', 'old']);
});
test('sortTodos: falls back to the id timestamp when no createdAt', function () {
    var arr = [{ title: 'mid', id: mkId(200) }, { title: 'new', id: mkId(300) }, { title: 'old', id: mkId(100) }];
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'oldest')), ['old', 'mid', 'new']);
});
test('sortTodos: createdAt wins over id timestamp', function () {
    var arr = [{ title: 'a', id: mkId(100), createdAt: 999 }, { title: 'b', id: mkId(500), createdAt: 1 }];
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'oldest')), ['b', 'a']);
});
test('sortTodos: items with no order signal keep stored order (stable)', function () {
    var arr = [{ title: 'one' }, { title: 'two' }, { title: 'three' }];
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'newest')), ['one', 'two', 'three']);
    assert.deepStrictEqual(titles(core.sortTodos(arr, 'oldest')), ['one', 'two', 'three']);
});
test('sortTodos: returns the same todo references, reordered', function () {
    var a = { title: 'a', createdAt: 2 }, b = { title: 'b', createdAt: 1 };
    var out = core.sortTodos([a, b], 'oldest');
    assert.strictEqual(out[0], b);
    assert.strictEqual(out[1], a);
});

// ---- planSync: the cross-device last-write-wins decision -----------------
// planSync(local, remote) decides what a device should do when it sees the
// remote blob. local = { updatedAt, hasData, synced }; remote = parsed blob
// (or null/garbage). Returns { action: 'push' | 'pull' | 'merge' | 'none' }.
//   push  -> our local copy is authoritative; upload it.
//   pull  -> remote is newer; adopt it wholesale (blob last-write-wins).
//   merge -> first contact on this device with a non-empty remote; union both
//            (via the tested mergeImport path) so no offline work is lost.
//   none  -> nothing to do.
test('planSync: empty remote + local has data -> push (seed remote)', function () {
    assert.strictEqual(core.planSync({ updatedAt: 5, hasData: true, synced: false }, null).action, 'push');
    assert.strictEqual(core.planSync({ updatedAt: 0, hasData: true, synced: false },
        { updatedAt: 0, todos: [], recycleBin: [] }).action, 'push');
});
test('planSync: empty remote + local empty -> none', function () {
    assert.strictEqual(core.planSync({ updatedAt: 0, hasData: false, synced: false }, null).action, 'none');
});
test('planSync: first contact with a non-empty remote -> merge (no data loss)', function () {
    var r = { updatedAt: 100, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 0, hasData: false, synced: false }, r).action, 'merge');
    // even if our local clock looks "newer", an un-synced device must union, not clobber
    assert.strictEqual(core.planSync({ updatedAt: 999, hasData: true, synced: false }, r).action, 'merge');
});
test('planSync: synced + remote newer -> pull', function () {
    var r = { updatedAt: 200, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 100, hasData: true, synced: true }, r).action, 'pull');
});
test('planSync: synced + local newer -> push', function () {
    var r = { updatedAt: 100, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 200, hasData: true, synced: true }, r).action, 'push');
});
test('planSync: synced + equal timestamps -> none', function () {
    var r = { updatedAt: 150, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 150, hasData: true, synced: true }, r).action, 'none');
});
test('planSync: garbage/non-object remote is treated as no data', function () {
    assert.strictEqual(core.planSync({ updatedAt: 5, hasData: true, synced: true }, 123).action, 'push');
    assert.strictEqual(core.planSync({ updatedAt: 5, hasData: true, synced: true }, undefined).action, 'push');
});

console.log('\nAll ' + passed + ' tests passed.');
