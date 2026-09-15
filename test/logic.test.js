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

// ---- realMoveIndices (filtered-view reorder mapping) --------------------
// Apply the splice the way moveItem does, to assert the resulting order.
function applyMove(full, m) { var moved = full[m.from]; full.splice(m.from, 1); full.splice(m.to, 0, moved); return full; }
test('realMoveIndices: all-view move maps 1:1 (visible === full)', function () {
    var A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' }, D = { id: 'd' };
    var full = [A, B, C, D];
    var m = core.realMoveIndices(full, [A, B, C, D], 0, 2);
    assert.deepStrictEqual(m, { from: 0, to: 2 });
    assert.deepStrictEqual(applyMove(full.slice(), m).map(function (t) { return t.id; }), ['b', 'c', 'a', 'd']);
});
test('realMoveIndices: filtered view maps visible indices onto full list', function () {
    var A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' }, D = { id: 'd' };
    var full = [A, B, C, D];
    var visible = [B, D]; // e.g. the two ongoing items, A & C hidden/completed
    // drag visible 0 (B) onto visible 1 (D)
    var m = core.realMoveIndices(full, visible, 0, 1);
    assert.deepStrictEqual(m, { from: 1, to: 3 });
    var out = applyMove(full.slice(), m).map(function (t) { return t.id; });
    assert.deepStrictEqual(out, ['a', 'c', 'd', 'b']); // hidden a,c stay; visible becomes [d,b]
});
test('realMoveIndices: hidden items keep their positions (move up across a hidden one)', function () {
    var A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' }, D = { id: 'd' };
    var full = [B, A, C, D]; // A hidden (completed), visible = [B, C, D]
    var visible = [B, C, D];
    // drag visible 2 (D) onto visible 0 (B)
    var m = core.realMoveIndices(full, visible, 2, 0);
    assert.deepStrictEqual(m, { from: 3, to: 0 });
    var out = applyMove(full.slice(), m).map(function (t) { return t.id; });
    assert.deepStrictEqual(out, ['d', 'b', 'a', 'c']); // A still right after the moved-from gap; visible [d,b,c]
});
test('realMoveIndices: same position / out of range / not found -> null', function () {
    var A = { id: 'a' }, B = { id: 'b' }, X = { id: 'x' };
    assert.strictEqual(core.realMoveIndices([A, B], [A, B], 1, 1), null); // no-op
    assert.strictEqual(core.realMoveIndices([A, B], [A, B], 0, 5), null); // to out of range
    assert.strictEqual(core.realMoveIndices([A, B], [A, B], 9, 0), null); // from out of range
    assert.strictEqual(core.realMoveIndices([A, B], [X, A], 0, 1), null); // X not in full
});

// ---- planSync: the cross-device sync decision ----------------------------
// planSync(local, remote) decides what a device should do when it sees the
// remote blob. local = { updatedAt, hasData, synced, baseAt }; remote = parsed
// blob (or null/garbage). Returns
// { action: 'push' | 'pull' | 'rebase' | 'merge' | 'none' }.
//   push   -> only this device moved on from the version both last agreed on.
//   pull   -> only the server moved; adopt it.
//   rebase -> BOTH moved; three-way merge (merge3), then upload.
//   merge  -> first contact on this device; union via mergeImport.
//   none   -> nothing to do.
// The decision compares both sides against `baseAt` — the version this device
// last pulled or pushed — rather than comparing two clocks, which is what lets
// a tab notice someone else wrote while it was holding an edit.
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
test('planSync: only the server moved -> pull', function () {
    var r = { updatedAt: 200, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 100, baseAt: 100, hasData: true, synced: true }, r).action, 'pull');
});
test('planSync: only this device moved -> push', function () {
    var r = { updatedAt: 100, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 200, baseAt: 100, hasData: true, synced: true }, r).action, 'push');
});
test('planSync: both moved -> rebase (three-way merge)', function () {
    var r = { updatedAt: 150, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 200, baseAt: 100, hasData: true, synced: true }, r).action, 'rebase');
});
test('planSync: REGRESSION — an API write is not overwritten by a dirty tab', function () {
    // The v1.10.2 known limitation: the tab held an unsent edit (local stamp
    // 200) when api.php wrote at 120 — a LOWER stamp, since the tab's clock ran
    // ahead. Timestamp comparison said "local is newer, push", which buried the
    // API task. Against the base version, both sides moved, so it merges.
    var r = { updatedAt: 120, todos: [{ id: 'api-1', title: 'added by Claude' }] };
    assert.strictEqual(core.planSync({ updatedAt: 200, baseAt: 100, hasData: true, synced: true }, r).action, 'rebase');
});
test('planSync: nothing moved -> none', function () {
    var r = { updatedAt: 150, todos: [{ id: 'a1', title: 'X' }] };
    assert.strictEqual(core.planSync({ updatedAt: 150, baseAt: 150, hasData: true, synced: true }, r).action, 'none');
});
test('planSync: device synced before v1.11.0 (no base) rebases once, or is idle', function () {
    var r = { updatedAt: 150, todos: [{ id: 'a1', title: 'X' }] };
    // No ancestor recorded and the two disagree: merge with no base (keep both
    // sides) rather than let either clobber the other.
    assert.strictEqual(core.planSync({ updatedAt: 100, hasData: true, synced: true }, r).action, 'rebase');
    // Same version on both sides: nothing to reconcile, just adopt the ancestor.
    assert.strictEqual(core.planSync({ updatedAt: 150, hasData: true, synced: true }, r).action, 'none');
});
test('planSync: garbage/non-object remote is treated as no data', function () {
    assert.strictEqual(core.planSync({ updatedAt: 5, baseAt: 5, hasData: true, synced: true }, 123).action, 'push');
    assert.strictEqual(core.planSync({ updatedAt: 5, baseAt: 5, hasData: true, synced: true }, undefined).action, 'push');
});

// ---- merge3: the three-way merge ----------------------------------------
// merge3(base, local, remote) reconciles two sides that both moved on from a
// common ancestor. Each side is { slogan, todos, recycleBin }. This is what
// runs when a push is refused with 409 — it must lose nothing either side did.
function st(todos, recycleBin, slogan) {
    return { slogan: slogan, todos: todos || [], recycleBin: recycleBin || [] };
}
function tk(id, title, completed) {
    return { id: id, title: title, completed: !!completed, removed: false };
}
function idsOf(list) { return list.map(function (t) { return t.id; }); }

test('merge3: THE BUG — an API add and this tab\'s unsent edit both survive', function () {
    // Tab pulled [a], then renamed it and added "mine" without pushing yet;
    // meanwhile api.php (Claude) added "theirs" to the stored copy.
    var base = st([tk('a', 'shared')]);
    var local = st([tk('mine', 'typed in the tab'), tk('a', 'shared, renamed')]);
    var remote = st([tk('theirs', 'added by Claude'), tk('a', 'shared')]);
    var out = core.merge3(base, local, remote);
    assert.deepStrictEqual(idsOf(out.todos), ['theirs', 'mine', 'a']); // arrival on top
    assert.strictEqual(out.todos[2].title, 'shared, renamed');         // the tab's edit kept
});
test('merge3: add/add — both new tasks are kept', function () {
    var out = core.merge3(st([tk('a', 'A')]), st([tk('l', 'L'), tk('a', 'A')]),
        st([tk('r', 'R'), tk('a', 'A')]));
    assert.deepStrictEqual(idsOf(out.todos), ['r', 'l', 'a']);
});
test('merge3: delete/delete — gone from both stays gone', function () {
    var out = core.merge3(st([tk('a', 'A'), tk('b', 'B')]), st([tk('a', 'A')]), st([tk('a', 'A')]));
    assert.deepStrictEqual(idsOf(out.todos), ['a']);
});
test('merge3: delete/edit — an edit beats a delete (nothing written is lost)', function () {
    var base = st([tk('a', 'A'), tk('b', 'B')]);
    var out = core.merge3(base, st([tk('a', 'A')]), st([tk('a', 'A'), tk('b', 'B edited')]));
    assert.deepStrictEqual(idsOf(out.todos).sort(), ['a', 'b']);
    assert.strictEqual(out.todos.filter(function (t) { return t.id === 'b'; })[0].title, 'B edited');
});
test('merge3: a delete the other side did not touch IS honoured', function () {
    var base = st([tk('a', 'A'), tk('b', 'B')]);
    var out = core.merge3(base, st([tk('a', 'A'), tk('b', 'B')]), st([tk('a', 'A')]));
    assert.deepStrictEqual(idsOf(out.todos), ['a']);
});
test('merge3: different fields on the same task both apply', function () {
    var base = st([tk('a', 'A', false)]);
    var out = core.merge3(base, st([tk('a', 'A renamed', false)]), st([tk('a', 'A', true)]));
    assert.strictEqual(out.todos[0].title, 'A renamed'); // local changed the title
    assert.strictEqual(out.todos[0].completed, true);    // remote ticked it off
});
test('merge3: same field changed on both sides -> the tab wins', function () {
    var base = st([tk('a', 'A')]);
    var out = core.merge3(base, st([tk('a', 'local title')]), st([tk('a', 'remote title')]));
    assert.strictEqual(out.todos[0].title, 'local title');
});
test('merge3: trashed remotely + completed locally lands in the bin, completed', function () {
    var base = st([tk('a', 'A', false)]);
    var local = st([tk('a', 'A', true)]);                      // ticked off here
    var remote = st([], [{ id: 'a', title: 'A', completed: false, removed: true }]); // trashed there
    var out = core.merge3(base, local, remote);
    assert.deepStrictEqual(idsOf(out.todos), []);
    assert.deepStrictEqual(idsOf(out.recycleBin), ['a']);
    assert.strictEqual(out.recycleBin[0].completed, true);
});
test('merge3: restored remotely comes back out of the bin', function () {
    var base = st([], [{ id: 'a', title: 'A', removed: true }]);
    var out = core.merge3(base, st([], [{ id: 'a', title: 'A', removed: true }]), st([tk('a', 'A')]));
    assert.deepStrictEqual(idsOf(out.todos), ['a']);
    assert.deepStrictEqual(idsOf(out.recycleBin), []);
});
test('merge3: no known ancestor keeps both sides, local winning a clash', function () {
    var out = core.merge3(null, st([tk('l', 'L'), tk('a', 'local title')]),
        st([tk('r', 'R'), tk('a', 'remote title')]));
    assert.deepStrictEqual(idsOf(out.todos).sort(), ['a', 'l', 'r']);
    assert.strictEqual(out.todos.filter(function (t) { return t.id === 'a'; })[0].title, 'local title');
});
test('merge3: slogan — local edit wins, otherwise the remote one is adopted', function () {
    var base = st([tk('a', 'A')], [], 'old');
    assert.strictEqual(core.merge3(base, st([tk('a', 'A')], [], 'mine'),
        st([tk('a', 'A')], [], 'theirs')).slogan, 'mine');
    assert.strictEqual(core.merge3(base, st([tk('a', 'A')], [], 'old'),
        st([tk('a', 'A')], [], 'theirs')).slogan, 'theirs');
});
test('merge3: does not mutate the inputs', function () {
    var base = st([tk('a', 'A')]);
    var local = st([tk('a', 'A renamed'), tk('l', 'L')]);
    var remote = st([tk('a', 'A'), tk('r', 'R')]);
    var snapshot = JSON.stringify([base, local, remote]);
    core.merge3(base, local, remote);
    assert.strictEqual(JSON.stringify([base, local, remote]), snapshot);
});

// ---- PHP id-format cross-check -------------------------------------------
// api.php mints ids with todo_gen_id($ms, $counter) = 't' + base_convert($ms,
// 10, 36) . '-' . base_convert($counter, 10, 36) — deliberately matching
// genId()'s format so idTime() parses API-created tasks the same way it
// parses browser-created ones. PHP's base_convert(10, 36) and JS's
// Number.prototype.toString(36) are the same algorithm, so this reproduces
// the PHP formula without shelling out, keeping the suite zero-dependency.
test('idTime: parses an id in the PHP todo_gen_id() format', function () {
    var ms = 1757000000000, counter = 5;
    var phpStyleId = 't' + ms.toString(36) + '-' + counter.toString(36);
    // Verified 2026-09-08 against the actual PHP base_convert() output.
    assert.strictEqual(phpStyleId, 'tmf5kfojk-5');
    assert.strictEqual(core.idTime(phpStyleId), ms);
});

console.log('\nAll ' + passed + ' tests passed.');
